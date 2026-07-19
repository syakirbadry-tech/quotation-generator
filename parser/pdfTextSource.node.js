/**
 * pdfTextSource.node.js
 *
 * Node/CLI-only text-extraction backend, used for local development and
 * for testing the parser against sample PDFs from the command line.
 *
 * This is NOT part of the parser itself and is NOT what the shipped
 * browser tool will use - the browser build gets an equivalent
 * `extractPagesFromPdf`-shaped function backed by pdf.js instead. Nothing
 * in parseQuotation.js or any extractor imports this file; it only wires
 * into the test harness (test/run-sample.js). This separation is what
 * lets the exact same parsing logic run in both places.
 *
 * Requires the `pdftotext` CLI (poppler-utils) to be installed.
 */

'use strict';

const { execFileSync } = require('child_process');

/**
 * @param {string} pdfPath absolute path to a PDF file
 * @returns {string[]} one string of layout-preserved text per PDF page
 */
function extractPagesFromPdf(pdfPath) {
  const raw = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
    maxBuffer: 1024 * 1024 * 20,
  }).toString('utf8');
  // pdftotext separates pages with a form-feed character.
  return raw.split('\f');
}

module.exports = { extractPagesFromPdf };
