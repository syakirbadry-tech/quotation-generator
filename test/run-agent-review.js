/**
 * test/run-agent-review.js
 *
 * Smoke test for renderer/renderQuotation.js's renderAgentReviewHtml()
 * against both real sample PDFs. This is the FIRST screen an agent sees
 * for any quotation - it was found to be entirely unmigrated to
 * data.medical (still reading data.plan/data.contributions/data.benefits
 * directly), so every field showed as "not found in PDF" for a real
 * Asas360 quotation even though the parser had already extracted it
 * correctly. Locks in the fix with real data from both products.
 *
 * Usage: node test/run-agent-review.js
 */

'use strict';

const assert = require('assert');
const { extractPagesFromPdf } = require('../parser/pdfTextSource.node.js');
const { parseQuotation } = require('../parser/index.js');
const { renderAgentReviewHtml } = require('../renderer/renderQuotation.js');

const ANUGERAHMAX_PDF = '/Users/syakir/Library/Mobile Documents/com~apple~CloudDocs/Santun_Syafitri_Binti_Mulyadi_14072026182021.pdf';
const ASAS360_PDF = '/Users/syakir/Library/Mobile Documents/com~apple~CloudDocs/Yusuf_&_Ayah_21072026221134.pdf';

let pass = 0;
let fail = 0;
function ok(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}`);
    fail++;
  }
}

console.log('=== Agent review: AnugerahMax ===');
{
  const result = parseQuotation(extractPagesFromPdf(ANUGERAHMAX_PDF), { sourceFileName: 'anugerahmax.pdf' });
  const html = renderAgentReviewHtml(result);
  ok('client name populated', html.includes('Santun Syafitri Binti Mulyadi'));
  ok('monthly total amount payable populated', html.includes('RM 176.00'));
  ok('plan populated', html.includes('Medic TotalCare 200'));
  ok('room & board populated', html.includes('RM 200/day'));
  ok('coverage term populated', html.includes('to Age 70'));
  ok('contribution breakdown shown (AnugerahMax has real ISA/Wakalah/rider data)', html.includes('Wakalah Certificate Charge'));
  ok('Product Options Table section is gone', !html.includes('Other options to consider'));
  ok('no "Recommended"/"Option 1"/"Option 2" labels leak through', !html.includes('Recommended</div>') && !/>Option 1</.test(html) && !/>Option 2</.test(html));
}

console.log('\n=== Agent review: Asas360 ===');
{
  const result = parseQuotation(extractPagesFromPdf(ASAS360_PDF), { sourceFileName: 'asas360.pdf' });
  const html = renderAgentReviewHtml(result);
  ok('client name populated (not "not found in PDF")', html.includes('>Yusuf<'));
  ok('monthly total amount payable populated from the top-level field', html.includes('RM 337.00'));
  ok('plan populated', html.includes('Health360 200'));
  ok('room & board populated', html.includes('RM 200/day'));
  ok('coverage term populated', html.includes('to Age 60'));
  ok('Lifetime Medical Fund figure label used instead of "Annual Limit"', html.includes('Lifetime Medical Fund'));
  ok('Smart Value Point figure populated', html.includes('No Limit, subject to Smart Value Point'));
  ok('co-payment populated', html.includes('Deductible RM500'));
  ok('benefits table populated (not "benefits table not found")', !html.includes('benefits table not found'));
  ok('medical exclusions populated (not "exclusions not found")', !html.includes('exclusions not found'));
  ok('no broken 3-line AnugerahMax contribution breakdown shown for an investment-linked product', !html.includes('Wakalah Certificate Charge'));
  ok('single Monthly Total Amount Payable line still shown instead', html.includes('Monthly Total Amount Payable'));
  ok('Product Options Table section is gone', !html.includes('Other options to consider'));
  ok('no "Recommended"/"Option 1"/"Option 2" labels leak through', !html.includes('Recommended</div>') && !/>Option 1</.test(html) && !/>Option 2</.test(html));
  ok('zero required-field errors', html.includes('No required fields are missing.'));
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
