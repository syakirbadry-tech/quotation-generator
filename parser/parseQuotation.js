/**
 * parseQuotation.js
 *
 * The only "orchestrator" in this module. As of the Version 1 Medical
 * Card Engine architecture (see
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md), it:
 *   1. builds the page-number-agnostic document view once,
 *   2. classifies which supported product the document is (never by
 *      filename - see classifyDocument.js),
 *   3. dispatches to that product's own extractor (extractors/*.js),
 *      each of which understands only its own PDF structure and layout,
 *   4. runs that product's own validation (unchanged for AnugerahMax -
 *      see validate.js's header comment for why regression risk here is
 *      structurally near-zero),
 *   5. normalizes the result into the product-agnostic `data.medical`
 *      shape every renderer/comparison/review-page consumer should read
 *      from (see normalize/toMedicalJson.js) and attaches the matching
 *      Coverage Strategy explanation (see coverageStrategy.js),
 *   6. returns { data, warnings, errors } - unchanged shape/contract for
 *      every existing AnugerahMax caller; `data.medical` is a purely
 *      additive new field, nothing existing is removed or renamed.
 *
 * This file must never contain PDF-parsing logic itself, and it must
 * never render HTML - see the file header of each extractor and
 * validate.js for where those responsibilities actually live.
 */

'use strict';

const { buildDocument } = require('./lineUtils');
const { classifyDocument } = require('./classifyDocument');
const { extractAnugerahMax } = require('./extractors/anugerahmax');
const { extractAsas360 } = require('./extractors/asas360');
const { fromAnugerahMax, fromAsas360 } = require('./normalize/toMedicalJson');
const { fromAnugerahMax: protectionFromAnugerahMax, fromAsas360: protectionFromAsas360 } = require('./normalize/toProtectionJson');
const { getCoverageStrategy } = require('./coverageStrategy');
const { validateQuotation } = require('./validate');
const { validateMedical } = require('./validateMedical');
const { validateProtection } = require('./validateProtection');

const UNSUPPORTED_PRODUCT_MESSAGE =
  'Could not identify this Product Illustration as a supported product (PruBSN AnugerahMax or PruBSN Asas360).';

/**
 * Runs product-specific validation, normalizes into data.medical, and
 * validates that normalized shape - the whole back half of
 * parseQuotation() below, shared so this exact same product-aware
 * decision (never running AnugerahMax's own validateQuotation() against
 * Asas360 data) lives in exactly one place. Also used by callers that
 * need to RE-run this after an agent hand-edits an extracted field (e.g.
 * browser-tool/app.js's revalidate flow) - data.medical is DERIVED from
 * data.plan/data.benefits (AnugerahMax) or data.medicalRider (Asas360),
 * so an edit to the raw extracted field must regenerate data.medical too,
 * or the renderer (which reads only data.medical) would keep showing the
 * pre-edit value.
 *
 * @param {object} data an extractor's output - already has either
 *   data.plan/data.contributions/data.benefits (AnugerahMax) or
 *   data.medicalRider (Asas360) - mutated in place: data.medical is
 *   (re)assigned.
 * @returns {{ warnings: object[], errors: object[] }}
 */
function normalizeAndValidate(data) {
  const isAsas360 = Boolean(data && data.medicalRider);
  const warnings = [];
  const errors = [];

  // validateQuotation() only understands AnugerahMax's own data.plan/
  // data.contributions/data.benefits field names - running it against
  // Asas360's differently-shaped data would produce a wall of false
  // "required field missing" errors for fields Asas360 never had in the
  // first place. Asas360's own required-field checking lives entirely in
  // validateMedical() below, keyed off data.medical.
  if (!isAsas360) {
    const validation = validateQuotation(data);
    warnings.push(...validation.warnings);
    errors.push(...validation.errors);
  }

  const medicalWarnings = [];
  data.medical = isAsas360 ? fromAsas360(data, medicalWarnings) : fromAnugerahMax(data, medicalWarnings);
  warnings.push(...medicalWarnings);

  const medicalValidation = validateMedical(data.medical);
  warnings.push(...medicalValidation.warnings);
  errors.push(...medicalValidation.errors);

  const strategy = getCoverageStrategy(data.medical.coverageModel);
  if (strategy) data.medical.coverageExplanation = strategy.explanation;

  // --- Protection domain (see normalize/toProtectionJson.js) ---
  // Basic-plan/Death/TPD/Cash Value facts, kept in their own section,
  // separate from data.medical - warning-only validation, since this is
  // an additive domain, not a pre-existing hard requirement.
  data.protection = isAsas360 ? protectionFromAsas360(data) : protectionFromAnugerahMax(data);
  const protectionValidation = validateProtection(data.protection);
  warnings.push(...protectionValidation.warnings);
  errors.push(...protectionValidation.errors);

  return { warnings, errors };
}

/**
 * @param {string[]} pages one string of extracted text per PDF page (any
 *   text-extraction backend can supply this - see pdfTextSource.node.js
 *   for the dev/test one; a browser build supplies an equivalent using
 *   pdf.js)
 * @param {object} [options]
 * @param {string} [options.sourceFileName]
 * @param {number} [options.validityDays] how many days the generated
 *   `validUntil` should be after the quotation date (default 14)
 * @param {string} [options.quotationNumber] an agent-assigned quotation
 *   number, if one has already been decided - never invented here
 * @returns {{ data: object, warnings: object[], errors: object[] }}
 */
function parseQuotation(pages, options = {}) {
  const doc = buildDocument(pages);
  const classification = classifyDocument(doc);

  if (!classification.product) {
    return {
      data: null,
      warnings: [],
      errors: [{ field: 'metadata.product', message: UNSUPPORTED_PRODUCT_MESSAGE }],
    };
  }

  const isAsas360 = classification.product === 'asas360';
  const { data, warnings, errors } = isAsas360
    ? extractAsas360(doc, options)
    : extractAnugerahMax(doc, options);

  const postExtraction = normalizeAndValidate(data);
  warnings.push(...postExtraction.warnings);
  errors.push(...postExtraction.errors);

  return { data, warnings, errors };
}

module.exports = { parseQuotation, normalizeAndValidate };
