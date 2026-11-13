/**
 * products/index.js
 *
 * The story deck's product registry. Each profile says how to recognise a
 * product's quotation and the few words that differ between products
 * (names, the product page link, what the medical card is called). All
 * the numbers come from the parsed quotation itself.
 *
 * To add a product: write a profile like anugerahmax.js, add it to
 * PRODUCTS below, and make sure the parser fills the shared `medical` and
 * `protection` blocks for it. Anything the profile doesn't say falls back
 * to the generic profile, so a new product still gets a full deck.
 */

'use strict';

const anugerahmax = require('./anugerahmax.js');
const asas360 = require('./asas360.js');
const generic = require('./generic.js');

const PRODUCTS = [anugerahmax, asas360];

function productFor(data) {
  const found = PRODUCTS.find((p) => p.match(data || {}));
  return found ? { ...generic, ...found } : { ...generic, name: (data && data.metadata && data.metadata.productName) || generic.name };
}

module.exports = { PRODUCTS, productFor };
