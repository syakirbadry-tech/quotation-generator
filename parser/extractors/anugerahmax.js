/**
 * extractors/anugerahmax.js
 *
 * Product extractor for PruBSN AnugerahMax + Medic TotalCare - the
 * Version-1 architecture's wrapper around this project's original,
 * frozen, already-verified 8-extractor pipeline (extractMetadata,
 * extractClient, extractAgent, extractPlan, extractContributions,
 * extractBenefits, extractOptions, extractProjection). See
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md for the full
 * Medical Card Engine design this file is one piece of.
 *
 * Deliberately NOT a rewrite: this is byte-for-byte the same
 * safeExtract()/collectSectionWarnings() orchestration that used to live
 * directly in parseQuotation.js, moved here unchanged so the exact same
 * anchor logic - covered by 40 passing assertions against the real
 * sample PDF - keeps running for every AnugerahMax document. This is the
 * mechanism that makes "zero regression" a structural guarantee: nothing
 * about how an AnugerahMax PDF is read changes at all.
 *
 * Returns the same `{ data: {metadata, client, agent, plan,
 * contributions, benefits, options, projection}, warnings, errors }`
 * shape parseQuotation() has always produced pre-validation - the caller
 * (parseQuotation.js) still runs the existing validate.js against it
 * unchanged, then additionally normalizes into data.medical (see
 * normalize/toMedicalJson.js) for the product-agnostic renderer.
 */

'use strict';

const { extractMetadata } = require('../extractMetadata');
const { extractClient } = require('../extractClient');
const { extractAgent } = require('../extractAgent');
const { extractPlan } = require('../extractPlan');
const { extractContributions } = require('../extractContributions');
const { extractBenefits } = require('../extractBenefits');
const { extractOptions } = require('../extractOptions');
const { extractProjection } = require('../extractProjection');

/**
 * Runs one extractor defensively: a thrown exception becomes a single
 * hard error for that section (instead of aborting the whole parse), and
 * that section's data comes back as null so downstream code and the
 * eventual renderer clearly see "this section needs manual entry" rather
 * than silently rendering with missing/invented data.
 */
function safeExtract(sectionName, fn, errors) {
  try {
    return fn();
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
 * @param {object} doc the document object from lineUtils.buildDocument()
 * @param {object} options same options parseQuotation() receives (sourceFileName, validityDays, quotationNumber)
 * @returns {{ data: object, warnings: object[], errors: object[] }}
 */
function extractAnugerahMax(doc, options) {
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

  // --- The one legitimate cross-section derivation (see original parseQuotation.js file header) ---
  if (data.plan && data.plan.coverageToAge == null && data.client && data.client.ageNextBirthday != null && data.plan.basicPlanTerm != null) {
    data.plan.coverageToAge = data.client.ageNextBirthday + data.plan.basicPlanTerm;
    warnings.push({
      field: 'plan.coverageToAge',
      message: `Derived as ageNextBirthday (${data.client.ageNextBirthday}) + basicPlanTerm (${data.plan.basicPlanTerm}); not found explicitly in the PDF.`,
    });
  }

  return { data, warnings, errors };
}

module.exports = { extractAnugerahMax };
