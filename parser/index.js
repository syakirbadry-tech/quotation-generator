/**
 * index.js
 *
 * Public API of the parser module. A future browser-based renderer (or
 * this repo's Node test harness) should only ever need to import from
 * here - individual extractor files are implementation detail.
 */

'use strict';

const { parseQuotation, normalizeAndValidate } = require('./parseQuotation');
const { AGENTS, getAgentConfig } = require('./agents');

module.exports = { parseQuotation, normalizeAndValidate, AGENTS, getAgentConfig };
