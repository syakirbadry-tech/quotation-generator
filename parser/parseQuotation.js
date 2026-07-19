/**
 * parseQuotation.js
 *
 * The only "orchestrator" in this module. It does not itself locate or
 * clean any data - that's each extractXxx()'s job - it just:
 *   1. builds the page-number-agnostic document view once,
 *   2. runs every extractor (each independently, each defensively -
 *      one section failing does not stop the others),
 *   3. performs the one piece of cross-section work that legitimately
 *      doesn't belong inside a single extractor (deriving coverageToAge
 *      from client.ageNextBirthday + plan.basicPlanTerm when the PDF's
 *      own "Until age N" wording wasn't found - see extractPlan.js),
 *   4. runs the validation layer against the assembled data,
 *   5. returns { data, warnings, errors }.
 *
 * This file must never contain PDF-parsing logic itself, and it must
 * never render HTML - see the file header of each extractor and
 * validate.js for where those responsibilities actually live.
 */

'use strict';

const { buildDocument } = require('./lineUtils');
const { extractMetadata } = require('./extractMetadata');
const { extractClient } = require('./extractClient');
const { extractAgent } = require('./extractAgent');
const { extractPlan } = require('./extractPlan');
const { extractContributions } = require('./extractContributions');
const { extractBenefits } = require('./extractBenefits');
const { extractOptions } = require('./extractOptions');
const { extractProjection } = require('./extractProjection');
const { validateQuotation } = require('./validate');

/**
 * Runs one extractor defensively: a thrown exception becomes a single
 * hard error for that section (instead of aborting the whole parse), and
 * that section's data comes back as null so downstream code and the
 * eventual renderer clearly see "this section needs manual entry" rather
 * than silently rendering with missing/invented data.
 */
function safeExtract(sectionName, fn, errors) {
  try {
    const result = fn();
    return result;
  } catch (err) {
    errors.push({
      field: sectionName,
      message: `Extractor for "${sectionName}" threw an error: ${err.message}`,
    });
    return null;
  }
}

/** Pulls a section's `_warnings` out into the shared warnings list, prefixed by section. */
function collectSectionWarnings(sectionName, sectionData, warnings) {
  if (!sectionData || !Array.isArray(sectionData._warnings)) return sectionData;
  for (const w of sectionData._warnings) {
    warnings.push(w.field ? w : { field: sectionName, message: w.message || String(w) });
  }
  const { _warnings, ...rest } = sectionData;
  return rest;
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
  const warnings = [];
  const errors = [];

  const metadata = safeExtract('metadata', () => extractMetadata(doc, options), errors);
  const client = safeExtract('client', () => extractClient(doc), errors);
  const agent = safeExtract('agent', () => extractAgent(doc), errors);
  const plan = safeExtract('plan', () => extractPlan(doc), errors);
  const contributions = safeExtract('contributions', () => extractContributions(doc), errors);
  const benefits = safeExtract('benefits', () => extractBenefits(doc), errors);
  const optionsSection = safeExtract('options', () => extractOptions(doc), errors);
  const projection = safeExtract('projection', () => extractProjection(doc), errors);

  const data = {
    metadata: collectSectionWarnings('metadata', metadata, warnings),
    client: collectSectionWarnings('client', client, warnings),
    agent: collectSectionWarnings('agent', agent, warnings),
    plan: collectSectionWarnings('plan', plan, warnings),
    contributions: collectSectionWarnings('contributions', contributions, warnings),
    benefits: collectSectionWarnings('benefits', benefits, warnings),
    options: collectSectionWarnings('options', optionsSection, warnings),
    projection: collectSectionWarnings('projection', projection, warnings),
  };

  // --- The one legitimate cross-section derivation (see file header) ---
  if (data.plan && data.plan.coverageToAge == null && data.client && data.client.ageNextBirthday != null && data.plan.basicPlanTerm != null) {
    data.plan.coverageToAge = data.client.ageNextBirthday + data.plan.basicPlanTerm;
    warnings.push({
      field: 'plan.coverageToAge',
      message: `Derived as ageNextBirthday (${data.client.ageNextBirthday}) + basicPlanTerm (${data.plan.basicPlanTerm}); not found explicitly in the PDF.`,
    });
  }

  const validation = validateQuotation(data);
  warnings.push(...validation.warnings);
  errors.push(...validation.errors);

  return { data, warnings, errors };
}

module.exports = { parseQuotation };
