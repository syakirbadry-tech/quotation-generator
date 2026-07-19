/**
 * dev-check-pdfjs-extraction.js
 *
 * Local, Node-based fast-iteration harness for pdfTextSource.browser.js.
 * Not part of the shipped browser tool and not the official Phase 3
 * acceptance test (that happens in a real browser via the Claude_Browser
 * tooling) - this just lets the pdf.js-based line-reconstruction logic
 * be iterated on quickly using pdfjs-dist's legacy Node build, which
 * implements the same getDocument()/getTextContent() API surface real
 * browser pdf.js does.
 *
 * Usage: node test/browser-tool/dev-check-pdfjs-extraction.js <pdf-path>
 */

'use strict';

const fs = require('fs');
const path = require('path');

global.pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const { extractPagesFromPdf } = require('../../browser-tool/pdfTextSource.browser.js');
const { parseQuotation } = require('../../parser/index.js');

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node dev-check-pdfjs-extraction.js <pdf-path>');
  process.exit(1);
}

async function main() {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pages = await extractPagesFromPdf(data);
  console.log(`Extracted ${pages.length} pages via pdf.js.\n`);

  if (process.env.DUMP_PAGE) {
    const idx = parseInt(process.env.DUMP_PAGE, 10) - 1;
    console.log(`=== PAGE ${idx + 1} (pdf.js reconstruction) ===`);
    console.log(pages[idx]);
    console.log('=== END PAGE ===\n');
  }

  const { data: parsed, warnings, errors } = parseQuotation(pages, {
    sourceFileName: path.basename(pdfPath),
    validityDays: 14,
  });

  console.log(`=== ERRORS (${errors.length}) ===`);
  errors.forEach((e) => console.log(` - ${e.field}: ${e.message}`));
  console.log(`\n=== WARNINGS (${warnings.length}) ===`);
  warnings.forEach((w) => console.log(` - ${w.field}: ${w.message}`));

  console.log('\n=== spot-check key fields ===');
  console.log('client.fullName:', parsed.client.fullName);
  console.log('client.ageNextBirthday:', parsed.client.ageNextBirthday);
  console.log('agent.agentCode:', parsed.agent.agentCode);
  console.log('contributions.totalMonthlyContribution:', parsed.contributions.totalMonthlyContribution);
  console.log('benefits.benefitItems.length:', parsed.benefits.benefitItems.length);
  console.log(
    'options.columns[].annualContribution:',
    parsed.options.columns.map((c) => c.annualContribution)
  );
  console.log('options.columns[].coPaymentOption:', parsed.options.columns.map((c) => c.coPaymentOption));
  console.log('projection.projectionRows.length:', parsed.projection.projectionRows.length);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
