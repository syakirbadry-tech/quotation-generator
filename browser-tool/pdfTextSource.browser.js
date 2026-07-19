/**
 * pdfTextSource.browser.js
 *
 * Browser text-extraction backend - the production counterpart to
 * parser/pdfTextSource.node.js (which shells out to `pdftotext` and only
 * exists for local/CLI testing). This file is the one actually used by
 * the shipped browser tool.
 *
 * Everything happens client-side: the PDF's bytes never leave the
 * browser (no fetch, no upload) and pdf.js itself is loaded from the
 * vendored copy in browser-tool/vendor/, not a CDN, so the tool works
 * fully offline and nothing about the document - not even that it was
 * opened - is observable over the network.
 *
 * Like the Node backend, this produces `pages: string[]` - one
 * layout-preserving string per page - which is the ONLY interface the
 * frozen parser (parser/parseQuotation.js) depends on. Nothing in the
 * parser knows or cares that this file exists; swapping text-extraction
 * backends never requires touching a parser file.
 *
 * --- Why this isn't just "join the words together" ---
 *
 * The frozen parser was built and tested against `pdftotext -layout`
 * output, which represents each PDF page as plain text where columns are
 * visually preserved via runs of literal spaces (see lineUtils.js's
 * `splitColumns`, `boundedValueForLabel`, and the options-table
 * column-offset calibration in extractOptions.js - all of them lean on
 * "a wide gap of spaces means a new column"). pdf.js's `getTextContent()`
 * instead returns a flat list of positioned text fragments (each with an
 * x/y coordinate in PDF space). This module reconstructs
 * `pdftotext`-shaped text from those positions: group fragments into
 * rows by y-coordinate, order each row left-to-right, and convert the
 * horizontal gap between fragments into a proportional run of spaces
 * (using each fragment's own font size, so the same physical gap in
 * points produces roughly the same number of spaces regardless of a
 * page's font size). See KNOWN_LIMITATIONS.md for what to re-verify here
 * as real-world PDFs are tested.
 */

/* global pdfjsLib */

'use strict';

// Empirically, the width of a single space character is roughly a
// quarter to a third of the font's point size for the proportional
// sans/serif fonts typical in generated PDF reports (Helvetica-ish).
// This is a heuristic, not a font metric lookup - it only needs to be
// good enough that a real column gap (tens of points) reliably produces
// 2+ spaces while ordinary word-spacing (a few points) produces ~1.
const SPACE_WIDTH_RATIO = 0.28;
const DEFAULT_FONT_SIZE = 10;
const ROW_Y_TOLERANCE = 2; // PDF points

function estimateFontSize(transform) {
  // transform = [a, b, c, d, e, f]; for unrotated text, `d` is the
  // vertical scale, which tracks font size closely enough for spacing
  // purposes. Fall back to the vector magnitude, then a fixed default.
  const d = Math.abs(transform[3]);
  if (d > 0.01) return d;
  const magnitude = Math.hypot(transform[0], transform[1]);
  return magnitude > 0.01 ? magnitude : DEFAULT_FONT_SIZE;
}

/**
 * Turns one page's pdf.js `getTextContent().items` into a single
 * layout-preserving string, in the same spirit as a `pdftotext -layout`
 * page.
 *
 * Text coordinates from pdf.js are in raw PDF space, and PDF generators
 * routinely add a uniform page margin that has nothing to do with the
 * MediaBox origin (observed with Chrome's own `--print-to-pdf`: every
 * fragment on a page sat at x >= ~33pt, MediaBox origin notwithstanding).
 * `pdftotext -layout` evidently treats the leftmost text actually
 * present on a page as column 0, rather than trusting the page
 * geometry - so this normalizes the same way: subtract the minimum x
 * observed among this page's own fragments. Skipping this step gives
 * every line - even ones that should be flush-left - the same uniform,
 * spurious leading indent, which breaks every `^`-anchored regex in the
 * frozen parser (see extractMetadata.js, extractAgent.js, extractBenefits.js).
 */
function reconstructPageText(items) {
  const rawFragments = items
    .filter((it) => typeof it.str === 'string' && it.str.length > 0)
    .map((it) => ({
      text: it.str,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width || 0,
      fontSize: estimateFontSize(it.transform),
    }));

  const minX = rawFragments.length ? Math.min(...rawFragments.map((f) => f.x)) : 0;
  const fragments = rawFragments.map((f) => ({ ...f, x: f.x - minX }));

  // Group into rows by y-coordinate. PDF space has y increasing upward,
  // so rows are later sorted top-to-bottom by descending y.
  const rows = [];
  for (const frag of fragments) {
    let row = rows.find((r) => Math.abs(r.y - frag.y) <= ROW_Y_TOLERANCE);
    if (!row) {
      row = { y: frag.y, items: [] };
      rows.push(row);
    }
    row.items.push(frag);
  }
  rows.sort((a, b) => b.y - a.y);

  const lines = rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let cursorX = null;
    for (const frag of row.items) {
      const spaceWidth = Math.max(1, frag.fontSize * SPACE_WIDTH_RATIO);
      if (cursorX === null) {
        const leadingSpaces = Math.max(0, Math.round(frag.x / spaceWidth));
        line += ' '.repeat(Math.min(leadingSpaces, 200));
      } else {
        // Ligature glyphs (e.g. "fi" in "Benefits") and kerning-adjacent
        // runs come through as separate fragments with a near-zero (or
        // slightly negative) gap between them - below this threshold,
        // treat it as no space at all rather than rounding up to one,
        // or "Benefits:" becomes "Bene fi ts:". Only a gap that's a
        // meaningful fraction of a real space character counts as one.
        const gap = frag.x - cursorX;
        const threshold = spaceWidth * 0.35;
        const spaces = gap >= threshold ? Math.max(1, Math.round(gap / spaceWidth)) : 0;
        line += ' '.repeat(Math.min(spaces, 200));
      }

      // Chrome's PDF export bridges a large horizontal jump (e.g.
      // between two independently-positioned elements) with a SINGLE
      // space character stretched to the width of the whole gap, rather
      // than emitting the gap as pure positioning with no glyph. Taken
      // literally that's one space no matter how wide the visual gap
      // was, which silently merges what should be two separate table
      // columns into one token. Treat such a fragment's own width as a
      // space COUNT instead of appending its single literal character.
      if (/^\s+$/.test(frag.text)) {
        const widthSpaces = Math.max(0, Math.round(frag.width / spaceWidth) - 1);
        line += ' '.repeat(Math.min(widthSpaces, 200));
      } else {
        line += frag.text;
      }
      cursorX = frag.x + frag.width;
    }
    return line.replace(/\s+$/, '');
  });

  return lines.join('\n');
}

/**
 * @param {ArrayBuffer|Uint8Array} data raw PDF bytes - the caller is
 *   responsible for reading the File client-side (e.g. via
 *   file.arrayBuffer()); this function never fetches or uploads anything
 * @returns {Promise<string[]>} one layout-preserving text string per page
 */
async function extractPagesFromPdf(data) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('pdfjsLib is not loaded - vendor/pdf.min.js must be included before this module runs.');
  }
  const loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    pages.push(reconstructPageText(textContent.items));
    page.cleanup();
  }
  await pdf.destroy();
  return pages;
}

// Exposed as a global for the plain-<script>-tag bundle (see build step);
// also exported via module.exports so the exact same file can be
// required from Node for local iteration/testing against the legacy
// pdfjs-dist Node build (see test/browser-tool/*.js).
const PDFTextSource = { extractPagesFromPdf, reconstructPageText };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PDFTextSource;
}
if (typeof window !== 'undefined') {
  window.PDFTextSource = PDFTextSource;
}
