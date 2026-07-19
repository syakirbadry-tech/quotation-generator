/**
 * lineUtils.js
 *
 * Low-level, product-agnostic helpers shared by every extractor.
 *
 * Design principle: locate data by ANCHOR (a literal heading or label that
 * PruBSN's PDF generator always prints), then use regex only to CLEAN the
 * value next to that anchor. Nothing in here searches "blindly" for a
 * pattern across the whole document without first being told where to look.
 *
 * None of this file depends on page numbers. Sections are located by
 * heading/label text and can span page boundaries; callers pass in
 * `doc.allLines`, a flat, page-number-agnostic view of the document.
 *
 * This file has zero Node.js-specific dependencies (no fs/child_process),
 * so it can be reused unchanged by a future browser (pdf.js) build.
 */

'use strict';

// Every content page of the PDF ends with this footer line. It's a
// convenient, reusable "end of this page's content" anchor.
const PAGE_FOOTER_ANCHOR = /^Presented by\s*:/i;

/**
 * Build a page-number-agnostic view of the document: a flat array of
 * { page, text } line records. `page` is kept only for diagnostics
 * (e.g. warnings can say "page 4"); extraction logic must never assume
 * a fixed page index.
 */
function buildDocument(pages) {
  const allLines = [];
  pages.forEach((pageText, pageIndex) => {
    const lines = (pageText || '').split('\n');
    lines.forEach((text) => {
      allLines.push({ page: pageIndex + 1, text });
    });
  });
  return { pageCount: pages.length, pages, allLines };
}

function lineMatches(text, matcher) {
  if (matcher instanceof RegExp) return matcher.test(text);
  return text.toLowerCase().includes(String(matcher).toLowerCase());
}

/**
 * Find the first line in the whole document matching `matcher`
 * (a literal substring or a RegExp), starting the search at
 * `fromGlobalIndex`. Returns the global line index, or -1.
 */
function findAnchorIndexInDoc(doc, matcher, fromGlobalIndex = 0) {
  for (let i = fromGlobalIndex; i < doc.allLines.length; i++) {
    if (lineMatches(doc.allLines[i].text, matcher)) return i;
  }
  return -1;
}

/**
 * Locate a bounded section of the document: everything between a start
 * anchor and an end anchor (both located by heading/label text, not by
 * page number). Returns the raw line strings in between, plus the global
 * indices so callers can do further anchor searches within the slice.
 */
function getSectionLines(doc, startMatcher, endMatcher, options = {}) {
  const { fromGlobalIndex = 0, includeStartLine = false } = options;
  const startIndex = findAnchorIndexInDoc(doc, startMatcher, fromGlobalIndex);
  if (startIndex === -1) {
    return { startIndex: -1, endIndex: -1, lines: [] };
  }
  const searchFrom = includeStartLine ? startIndex : startIndex + 1;
  let endIndex = endMatcher
    ? findAnchorIndexInDoc(doc, endMatcher, searchFrom)
    : doc.allLines.length;
  if (endIndex === -1) endIndex = doc.allLines.length;
  const lines = doc.allLines.slice(searchFrom, endIndex).map((l) => l.text);
  return { startIndex, endIndex, lines };
}

/**
 * Given a single line and a label that appears on it, return the text
 * value that follows the label's colon. The label itself is located as a
 * literal substring (the "anchor"); regex is used only to decide where
 * the value ends (a run of 2+ spaces, which is how the layout-preserving
 * text extraction marks the start of the *next* column/field on the same
 * line - PruBSN's PDF generator frequently prints two "Label : Value"
 * pairs on one physical line).
 */
function getValueAfterColon(line, label) {
  if (!line) return null;
  const idx = line.indexOf(label);
  if (idx === -1) return null;
  const rest = line.slice(idx + label.length);
  const colonIdx = rest.indexOf(':');
  if (colonIdx === -1) return null;
  const value = rest.slice(colonIdx + 1);
  const stop = value.match(/\s{2,}/);
  const trimmed = stop ? value.slice(0, stop.index) : value;
  const cleaned = trimmed.trim();
  return cleaned.length ? cleaned : null;
}

/**
 * PruBSN's PDF generator sometimes prints a 2-line label with the value
 * vertically centered between the two label lines (e.g. "Monthly Total
 * Amount" / ": RM 176.00" / "Payable"). This searches a small window of
 * lines around an anchor for the first line matching `pattern`,
 * regardless of whether it's before or after the anchor line itself.
 */
function findNearestValue(lines, anchorIndex, options) {
  const { pattern, maxDistance = 3, direction = 'after' } = options;
  const step = direction === 'before' ? -1 : 1;
  for (let d = 0; d <= maxDistance; d++) {
    const idx = anchorIndex + d * step;
    if (idx < 0 || idx >= lines.length) continue;
    const m = lines[idx].match(pattern);
    if (m) return m[0].trim();
  }
  return null;
}

/**
 * For a table row whose label wraps across 2+ lines with its value
 * squeezed in between (see findNearestValue's comment), or where the
 * label and its value share one physical line, the most robust
 * extraction is: "strip the label text (wherever it appears) and any
 * fully-excluded lines (e.g. a section-header line that happens to fall
 * inside this bounded slice), and keep whatever's left." Used for the
 * Medic TotalCare "Table of Benefits" rows.
 *
 * `excludeLines` lets a caller name other literal lines (e.g. known
 * section headers like "EXTENDED CARE BENEFITS") that must never be
 * treated as part of a value, even though they're not this row's label.
 */
function boundedValueForLabel(blockLines, labelText, excludeLines = []) {
  const label = labelText.trim();
  const cleaned = blockLines
    .map((raw) => {
      const line = raw.trim();
      if (!line || excludeLines.includes(line)) return '';
      const idx = line.indexOf(label);
      if (idx === -1) return line;
      const before = line.slice(0, idx).trim();
      const after = line
        .slice(idx + label.length)
        .replace(/^[,:]\s*/, '')
        .trim();
      return [before, after].filter(Boolean).join(' ');
    })
    .filter((l) => l.length > 0);
  return cleaned.join(' ').replace(/\s+/g, ' ').trim();
}

/** Strip "RM", thousands separators, etc. and parse a number. */
function parseCurrency(str) {
  if (str == null) return null;
  const m = String(str).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Parse the first integer found in a string (commas stripped first). */
function parseIntSafe(str) {
  if (str == null) return null;
  const m = String(str).replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** PruBSN prints dates as DD/MM/YYYY. */
function parseDateDMY(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  return { raw: str.trim(), iso };
}

/**
 * `-layout` text extraction preserves the PDF's horizontal spacing as
 * literal spaces, so columns of a single-line table row are reliably
 * separated by runs of 2+ spaces. Splits on that and drops empties.
 */
function splitColumns(line, minGap = 2) {
  const re = new RegExp(`\\s{${minGap},}`);
  return line
    .split(re)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Some PDF pages lay out two text columns side by side (e.g. "What is
 * covered? / What is not covered?"). Layout-preserving text extraction
 * interleaves their wrapped lines row-by-row, which reads as nonsense if
 * read top-to-bottom, and a per-line "split at the widest gap" heuristic
 * is unreliable because rows that only have LEFT-column content (a label
 * and its own value) also contain one wide-ish gap of their own.
 *
 * Instead, this calibrates the column boundary once, from the section's
 * own two-column HEADER row (e.g. "What is covered?" / "What is not
 * covered?") - the character offset at which the right-hand header title
 * starts is the same offset the PDF generator uses for every row's right
 * column beneath it. Any line that doesn't reach that far to the right
 * simply has no right-column content on that row and is skipped.
 *
 * Returns the right column's text fragments in reading order; join them
 * to reconstruct that column's flowing paragraph text.
 */
function splitTwoColumnByHeader(doc, headerMatcher, rightLabel, endMatcher) {
  const headerIndex = findAnchorIndexInDoc(doc, headerMatcher);
  if (headerIndex === -1) return { rightColumnOffset: -1, fragments: [] };
  const headerLine = doc.allLines[headerIndex].text;
  const offset = headerLine.indexOf(rightLabel);
  if (offset === -1) return { rightColumnOffset: -1, fragments: [] };

  const endIndex = endMatcher
    ? findAnchorIndexInDoc(doc, endMatcher, headerIndex + 1)
    : doc.allLines.length;
  const bodyEnd = endIndex === -1 ? doc.allLines.length : endIndex;

  const fragments = [];
  for (let i = headerIndex + 1; i < bodyEnd; i++) {
    const line = doc.allLines[i].text;
    if (line.length <= offset) continue;
    const value = line.slice(offset).trim();
    if (value) fragments.push(value);
  }
  return { rightColumnOffset: offset, fragments };
}

/**
 * Generic clause/bullet splitter for a reconstructed paragraph that has
 * no explicit delimiters between bullets (no bullet glyph survives text
 * extraction). Heuristic: a new clause starts wherever a capitalised word
 * follows a lowercase/closing-punctuation character - i.e. a sentence
 * boundary. Not perfect, but generic (not tied to this product's exact
 * wording) and safe to fall back on a single-item array if it doesn't fire.
 */
function splitIntoClauses(text) {
  return text
    .split(/(?<=[a-z0-9)%])\s+(?=[A-Z][a-z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parses a lettered list like "(a) ... (b) ... (aa) ..." into
 * { marker, text } items, joining wrapped continuation lines (any line
 * that doesn't start a new marker belongs to the current item).
 */
function splitLetteredList(blockLines) {
  const items = [];
  let current = null;
  const markerRe = /^\(([a-z]{1,2})\)\s*(.*)$/;
  for (const raw of blockLines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(markerRe);
    if (m) {
      if (current) items.push(current);
      current = { marker: m[1], text: m[2] };
    } else if (current) {
      current.text += ' ' + line;
    }
  }
  if (current) items.push(current);
  return items.map((it) => ({
    marker: it.marker,
    text: it.text.replace(/\s+/g, ' ').trim(),
  }));
}

/**
 * Every content page repeats "Quotation for <Client Name>" immediately
 * followed by the product name line. This is a very reliable anchor for
 * both the client's name (used by extractClient) and the product name
 * (used by extractMetadata) - shared here so both extractors agree on
 * the same source line rather than re-implementing the same search twice.
 */
function findRepeatingHeader(doc) {
  const idx = findAnchorIndexInDoc(doc, /^Quotation for\s+/i);
  if (idx === -1) return null;
  const clientName = doc.allLines[idx].text.replace(/^Quotation for\s+/i, '').trim();
  const productName = doc.allLines[idx + 1] ? doc.allLines[idx + 1].text.trim() : null;
  return { clientName, productName };
}

/**
 * Shared bounded slice for the page-2 "Benefits:" breakdown table
 * (ISA / Medic TotalCare / Protection Contribution / Wakalah Certificate
 * Charge / Total Monthly Amount Payable). Both extractPlan and
 * extractContributions need it, so it lives here once.
 */
function getBenefitsTableBlock(doc) {
  return getSectionLines(
    doc,
    /^\s*Benefits:\s*$/,
    /The benefit\(s\) payable under eligible certificate/i
  );
}

module.exports = {
  PAGE_FOOTER_ANCHOR,
  buildDocument,
  findAnchorIndexInDoc,
  getSectionLines,
  getValueAfterColon,
  findNearestValue,
  boundedValueForLabel,
  parseCurrency,
  parseIntSafe,
  parseDateDMY,
  splitColumns,
  splitTwoColumnByHeader,
  splitIntoClauses,
  splitLetteredList,
  findRepeatingHeader,
  getBenefitsTableBlock,
};
