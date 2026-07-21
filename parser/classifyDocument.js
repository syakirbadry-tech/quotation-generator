/**
 * classifyDocument.js
 *
 * Phase 1 of the Medical Card Engine's Version 1 architecture (see
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md for the full design).
 * Detects which of the two Version-1-supported products a PDF is, from its
 * own real printed content - never the source filename. Anchored against
 * the real running-header/cover-page text confirmed present in both real
 * sample documents this project has actually seen:
 *   - AnugerahMax sample: "PruBSN AnugerahMax" + "Medic TotalCare" appear
 *     repeatedly (cover page, every page's running header).
 *   - Asas360 sample: "PruBSN Asas360" + "Health360" appear the same way
 *     (see the real Yusuf & Ayah Product Illustration).
 *
 * Only the first few pages are scanned (the cover page + quotation summary
 * page, where both real samples print these phrases early and repeatedly) -
 * scanning the whole document is unnecessary and would risk a false match
 * against an incidental mention deep in an appendix.
 */

'use strict';

const SCAN_PAGE_COUNT = 3;

const PRODUCT_SIGNATURES = [
  {
    product: 'anugerahmax',
    productPattern: /PruBSN\s+AnugerahMax/i,
    riderPattern: /Medic\s+TotalCare/i,
  },
  {
    product: 'asas360',
    productPattern: /PruBSN\s+Asas360/i,
    riderPattern: /Health360/i,
  },
];

/**
 * @param {{pages: string[]}} doc same document object every extractor receives
 * @returns {{ product: 'anugerahmax'|'asas360'|null, confidence: 'high'|'low'|'none' }}
 */
function classifyDocument(doc) {
  const scanText = (doc.pages || []).slice(0, SCAN_PAGE_COUNT).join('\n');

  for (const sig of PRODUCT_SIGNATURES) {
    const hasProduct = sig.productPattern.test(scanText);
    const hasRider = sig.riderPattern.test(scanText);
    if (hasProduct && hasRider) {
      return { product: sig.product, confidence: 'high' };
    }
  }

  // Partial match (product name found, but not its expected medical rider,
  // or vice versa) - still not a supported combination, but worth telling
  // the caller it's "close" rather than a completely unrecognised document.
  for (const sig of PRODUCT_SIGNATURES) {
    if (sig.productPattern.test(scanText) || sig.riderPattern.test(scanText)) {
      return { product: null, confidence: 'low' };
    }
  }

  return { product: null, confidence: 'none' };
}

module.exports = { classifyDocument };
