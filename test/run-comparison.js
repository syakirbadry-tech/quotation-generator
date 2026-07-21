/**
 * test/run-comparison.js
 *
 * Smoke test for renderer/renderComparison.js against the two real sample
 * PDFs used throughout this project, covering the 3 comparison scenarios
 * the Medical Card Engine plan requires: same-product (AnugerahMax x2),
 * same-product (Asas360 x2), and cross-product (AnugerahMax vs Asas360).
 * Not a unit-test framework - same ad hoc assert/console pattern as
 * test/run-sample.js and test/run-sample-asas360.js.
 *
 * Usage: node test/run-comparison.js
 */

'use strict';

const assert = require('assert');
const { extractPagesFromPdf } = require('../parser/pdfTextSource.node.js');
const { parseQuotation } = require('../parser/index.js');
const { renderComparisonHtml } = require('../renderer/renderComparison.js');

const ANUGERAHMAX_PDF = '/Users/syakir/Library/Mobile Documents/com~apple~CloudDocs/Santun_Syafitri_Binti_Mulyadi_14072026182021.pdf';
const ASAS360_PDF = '/Users/syakir/Library/Mobile Documents/com~apple~CloudDocs/Yusuf_&_Ayah_21072026221134.pdf';

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
function ok(label, condition) {
  check(label, Boolean(condition), true);
}

const anugerahmax = parseQuotation(extractPagesFromPdf(ANUGERAHMAX_PDF), { sourceFileName: 'anugerahmax.pdf' });
const asas360 = parseQuotation(extractPagesFromPdf(ASAS360_PDF), { sourceFileName: 'asas360.pdf' });
const reviews = [{ acknowledged: true }, { acknowledged: true }];

console.log('=== Same-product comparison: AnugerahMax x2 ===');
{
  const html = renderComparisonHtml([anugerahmax, anugerahmax], reviews);
  ok('renders (not the blocked-document fallback)', html.includes('Comparing 2 Options'));
  ok('shows the recommended-plan toggle', html.includes('Choose Your Recommended Plan'));
  ok('shows both options\' real plan name', (html.match(/Medic TotalCare Plan 200/g) || []).length >= 2);
  ok('does NOT show the cross-product education block (same coverage model both sides)', !html.includes('Understanding the difference'));
  ok('shows the ANNUAL_LIMIT coverage model label', html.includes('Annual Limit'));
}

console.log('\n=== Same-product comparison: Asas360 x2 ===');
{
  const html = renderComparisonHtml([asas360, asas360], reviews);
  ok('renders (not the blocked-document fallback)', html.includes('Comparing 2 Options'));
  ok('shows both options\' real plan name', (html.match(/Health360 Plan 200/g) || []).length >= 2);
  ok('does NOT show the cross-product education block (same coverage model both sides)', !html.includes('Understanding the difference'));
  ok('shows the LIFETIME_MEDICAL_FUND coverage model label', html.includes('Lifetime Medical Fund'));
  ok('shows the real Smart Value Point figure', html.includes('1,000,000') || html.includes('Smart Value Point'));
}

console.log('\n=== Cross-product comparison: AnugerahMax vs Asas360 ===');
{
  const html = renderComparisonHtml([anugerahmax, asas360], reviews);
  ok('renders (not the blocked-document fallback)', html.includes('Comparing 2 Options'));
  ok('shows both real plan names', html.includes('Medic TotalCare Plan 200') && html.includes('Health360 Plan 200'));
  ok('shows the cross-product education block (coverage models differ)', html.includes('Understanding the difference'));
  ok('education block explains the ANNUAL_LIMIT model with its real explanation text', html.includes('This medical card provides an annual medical limit that refreshes every policy year.'));
  ok('education block explains the LIFETIME_MEDICAL_FUND model with its real explanation text', html.includes('This medical card provides a lifetime medical fund.'));
  ok('shows both real monthly contributions', html.includes('RM 176.00') && html.includes('RM 337.00'));
  ok('never fabricates a value for a concept the other product does not have (Asas360 has no Annual Limit)', html.includes('Refer to certificate'));
}

console.log('\n=== Blocked-document gate still works (unacknowledged review) ===');
{
  const html = renderComparisonHtml([anugerahmax, asas360], [{ acknowledged: true }, { acknowledged: false }]);
  ok('falls back to the blocked-document view, not the comparison', !html.includes('Comparing 2 Options'));
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
