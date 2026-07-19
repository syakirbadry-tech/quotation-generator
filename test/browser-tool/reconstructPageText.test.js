/**
 * reconstructPageText.test.js
 *
 * Regression test for the v1.2.1 browser-real-PDF fixes. Tests
 * `reconstructPageText` directly against hand-built pdf.js-shaped item
 * arrays reproducing the exact bug patterns found in a real PruBSN PDF -
 * no PDF file needed, so this is safe to commit (no real client data,
 * synthetic fixture also not required). Each pattern below is a
 * minimal, faithful reproduction of what pdf.js's getTextContent()
 * actually returned for the real document (positions/widths taken
 * directly from the investigation), with names and numbers replaced by
 * obviously-fake placeholders.
 *
 * Usage: node test/browser-tool/reconstructPageText.test.js
 */

'use strict';

const assert = require('assert');
const { reconstructPageText } = require('../../browser-tool/pdfTextSource.browser.js');

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`  PASS  ${label}`);
    pass++;
  } catch (err) {
    console.log(`  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}

// Builds a fake pdf.js text item. transform = [fontSizeX, 0, 0, fontSizeY, x, y].
function item(str, x, y, width, fontSize = 9) {
  return { str, transform: [fontSize, 0, 0, fontSize, x, y], width };
}

const normalizeSpace = (s) => s.trim().replace(/\s+/g, ' ');

console.log('=== Bug 1: exact-duplicate "faux bold" text items (agent footer line) ===');
{
  // Reproduces the real bug: pdf.js reported "Presented by" and
  // ": FAKE NAME FAKE00000" as TWO byte-identical copies each (same
  // text, same x, same y, same width) - concatenating every item
  // verbatim used to produce "Presented byPresented by: ...: ...",
  // which no longer matches the parser's `/^Presented by\s*:/i` anchor.
  const items = [
    item('Presented by', 20, 36, 37.65),
    item(': FAKE NAME FAKE00000', 59.31, 36, 154.55),
    item('Presented by', 20, 36, 37.65), // exact duplicate
    item(': FAKE NAME FAKE00000', 59.31, 36, 154.55), // exact duplicate
  ];
  const text = reconstructPageText(items);
  // "Presented by : X" (space before the colon) matches the real PDF's
  // and pdftotext's own convention - the parser's getValueAfterColon
  // already handles that spacing.
  check('dedupes exact overlapping fragments into one clean anchor-matchable line', normalizeSpace(text), 'Presented by : FAKE NAME FAKE00000');
  check('result actually matches the parser\'s anchor regex', /^Presented by\s*:/i.test(text.trim()), true);
}

console.log('\n=== Bug 2: 4x-duplicated footer text ("Page N of M") ===');
{
  const dup = (str, x, w) => [item(str, x, 6, w), item(str, x, 6, w), item(str, x, 6, w), item(str, x, 6, w)];
  const items = [...dup('Page', 268.84, 20), ...dup('1', 293, 5), ...dup('of', 300, 10), ...dup('33', 315, 10)];
  const text = reconstructPageText(items);
  check('collapses 4x duplicated word groups without repeating any word', normalizeSpace(text), 'Page 1 of 33');
}

console.log('\n=== Bug 3: phantom-width whitespace fragment (bogus gap) ===');
{
  // Reproduces the "Wakalah Certificate Charge" case: a whitespace
  // fragment with a wildly inflated width (109pt+) sits between two
  // words that are actually only ~2pt apart. Trusting that fragment's
  // own width (the old behaviour) inserted dozens of bogus spaces and
  // split one phrase into what looked like two unrelated columns.
  const items = [
    item('Wakalah', 386.4, 100, 33.5),
    item(' ', 419.9, 100, 109.7), // phantom - real gap to next word is ~2.3pt, not 109.7pt
    item('Certificate Charge', 422.18, 100, 71.7),
    item('7.00', 529.65, 100, 15.75),
  ];
  const text = reconstructPageText(items);
  check("ignores a whitespace fragment's own bogus width; uses real fragment gaps instead", normalizeSpace(text), 'Wakalah Certificate Charge 7.00');
}

console.log('\n=== Bug 4: borderline single-word-space gap in prose (must NOT look like a table column) ===');
{
  // Reproduces the exact real-PDF gap that used to trip the parser's
  // 3-column row detector: a genuine single space between two prose
  // fragments, ~3.96pt at an 8.25pt font size, sitting right next to a
  // genuine wide (~16.9pt) column-like gap in the same row.
  const items = [
    item('This is the annual takaful contribution for', 146.44, 200, 138.43, 8.25),
    item('The annual takaful contribution is lower', 301.73, 200, 133.62, 8.25), // ~16.9pt gap before this - a real column break
    item('The annual takaful contribution is higher', 439.31, 200, 136.36, 8.25), // ~3.96pt gap before this - NOT a column break
  ];
  const text = reconstructPageText(items);
  check('wide genuine gap (~16.9pt) stays a 2+ space column break', /for\s{2,}The annual takaful contribution is lower/.test(text), true);
  check('borderline single-word gap (~3.96pt) collapses to exactly 1 space', / lower The annual takaful contribution is higher/.test(text), true);
  check('borderline gap does NOT produce a 2+ space column break', /lower\s{2,}The annual takaful contribution is higher/.test(text), false);
}

console.log('\n=== Regression: ligature glyph split must not gain a space ("Benefits:") ===');
{
  const items = [item('Bene', 100, 50, 20, 9), item('ﬁ', 120, 50, 5, 9), item('ts:', 125, 50, 12, 9)];
  const text = reconstructPageText(items);
  check('ligature-adjacent fragments stay joined with no inserted space', text, 'Beneﬁts:');
}

console.log('\n=== Regression: wide table-column gaps still produce 2+ spaces (options table) ===');
{
  const items = [
    item('Type', 37.2, 300, 19.3, 8.9),
    item('Cashless facility', 191.4, 300, 63.8, 8.9),
    item('Cashless facility', 303.1, 300, 63.8, 8.9),
  ];
  const text = reconstructPageText(items);
  // Split on 2+ space runs (what the parser's splitColumns actually
  // does) and confirm it produces exactly the 3 expected column values -
  // "Cashless facility"'s own internal single space must NOT be mistaken
  // for a column break.
  const columns = text
    .trim()
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  check('splits into exactly 3 columns matching parser.splitColumns behaviour', columns, ['Type', 'Cashless facility', 'Cashless facility']);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
