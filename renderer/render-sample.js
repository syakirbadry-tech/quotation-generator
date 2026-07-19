/**
 * render-sample.js
 *
 * End-to-end demo/smoke test for Phase 2: runs the frozen Phase 1 parser
 * against a real PDF, then exercises BOTH renderer outputs so the
 * client-safe gate can actually be seen working:
 *   1. the agent review page (warnings/errors visible)
 *   2. the client page BEFORE agent acknowledgement (must be blocked)
 *   3. the client page AFTER a simulated agent review (full quotation,
 *      with an agent-supplied quotation number and valid-until date)
 *
 * No sample PDF path is hardcoded here on purpose: PruBSN Product
 * Illustrations contain a real client's name, NRIC-adjacent detail, and
 * financial information, and this file (unlike the file it points at) IS
 * meant to be committed to git. Pass the path explicitly.
 *
 * Usage:
 *   node renderer/render-sample.js /path/to/quotation.pdf
 *
 * Output is written under quotation-generator/output/, which is
 * git-ignored - see .gitignore.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { extractPagesFromPdf } = require('../parser/pdfTextSource.node.js');
const { parseQuotation } = require('../parser/index.js');
const { renderAgentReviewHtml, renderClientQuotationHtml } = require('./renderQuotation.js');

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node renderer/render-sample.js /path/to/quotation.pdf');
  console.error('(No default path is hardcoded here - see the file header comment for why.)');
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'output');
fs.mkdirSync(outDir, { recursive: true });

const pages = extractPagesFromPdf(pdfPath);
const parseResult = parseQuotation(pages, {
  sourceFileName: path.basename(pdfPath),
  validityDays: 14,
});
const { warnings, errors } = parseResult;

console.log(`Parsed "${path.basename(pdfPath)}": ${warnings.length} warnings, ${errors.length} errors.`);

// 1. Agent review page - always safe to generate, shows everything.
fs.writeFileSync(path.join(outDir, 'agent-review.html'), renderAgentReviewHtml(parseResult), 'utf8');
console.log('Wrote output/agent-review.html (INTERNAL ONLY)');

// 2. Client page BEFORE acknowledgement - must be a blocked notice, not a quotation.
const blockedHtml = renderClientQuotationHtml(parseResult, {});
fs.writeFileSync(path.join(outDir, 'client-quotation-BLOCKED-demo.html'), blockedHtml, 'utf8');
const isBlocked = blockedHtml.includes('This quotation is not ready to send');
console.log(`Wrote output/client-quotation-BLOCKED-demo.html (gate held: ${isBlocked})`);

// 3. Client page AFTER a simulated agent review.
const clientHtml = renderClientQuotationHtml(parseResult, {
  acknowledged: true,
  quotationNumber: 'DEMO-0001', // agent-assigned - never invented by the parser or renderer
  validUntilIso: parseResult.data.metadata.quotationDate
    ? parseResult.data.metadata.validUntil.iso // agent is choosing to accept the parser's suggested date here
    : null,
});
fs.writeFileSync(path.join(outDir, 'client-quotation.html'), clientHtml, 'utf8');
console.log('Wrote output/client-quotation.html (client-safe, post-review)');
