/**
 * validateMedical.js
 *
 * Phase 3 of the Medical Card Engine's Version 1 architecture (see
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md). Validates the
 * product-agnostic `data.medical` shape (see normalize/toMedicalJson.js)
 * - kept deliberately SEPARATE from the existing, frozen `validate.js`,
 * which continues to validate AnugerahMax's `data.plan`/
 * `data.contributions`/`data.benefits` exactly as it always has.
 *
 * Required fields differ by coverage model, not by a single fixed list -
 * an Asas360/Health360 quotation is never flagged for a missing
 * `annualLimit` (a concept that plan genuinely doesn't have), and an
 * AnugerahMax/Medic TotalCare quotation is never flagged for a missing
 * `lifetimeFundAmount`.
 */

'use strict';

const COMMON_REQUIRED_FIELDS = ['productName', 'riderName', 'planName', 'coverageModel', 'roomAndBoard', 'coPayment', 'coverageToAge'];

const MODEL_REQUIRED_FIELDS = {
  ANNUAL_LIMIT: ['annualLimit'],
  LIFETIME_MEDICAL_FUND: ['lifetimeFundAmount', 'costSharingAfterExhaustion'],
};

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * @param {object} medical the `data.medical` object produced by normalize/toMedicalJson.js
 * @returns {{ warnings: object[], errors: object[] }}
 */
function validateMedical(medical) {
  const warnings = [];
  const errors = [];

  if (!medical) {
    errors.push({ field: 'medical', message: 'No normalized medical data was produced for this quotation.' });
    return { warnings, errors };
  }

  const requiredFields = [...COMMON_REQUIRED_FIELDS, ...(MODEL_REQUIRED_FIELDS[medical.coverageModel] || [])];
  for (const field of requiredFields) {
    const value = getPath(medical, field);
    const fail = value == null;
    // [DIAGNOSTIC 5] Rule-by-rule trace for the product-agnostic medical
    // validator - runs for BOTH products, keyed off medical.coverageModel.
    console.log('[DIAGNOSTIC 5] Rule (validateMedical): medical.%s -> %s', field, fail ? 'FAIL' : 'PASS');
    if (fail) {
      errors.push({ field: `medical.${field}`, message: `Required field "medical.${field}" is missing for coverage model "${medical.coverageModel}".` });
    }
  }

  if (!medical.coverageModel) {
    errors.push({ field: 'medical.coverageModel', message: 'Coverage model could not be determined - this quotation cannot be rendered.' });
  } else if (!MODEL_REQUIRED_FIELDS[medical.coverageModel]) {
    errors.push({ field: 'medical.coverageModel', message: `Unrecognised coverage model "${medical.coverageModel}".` });
  }

  if (!medical.benefitItems || !medical.benefitItems.length) {
    warnings.push({ field: 'medical.benefitItems', message: 'No benefit items were extracted for this medical rider.' });
  }
  if (!medical.medicalExclusions || !medical.medicalExclusions.length) {
    warnings.push({ field: 'medical.medicalExclusions', message: 'No medical exclusions were extracted for this medical rider.' });
  }

  return { warnings, errors };
}

module.exports = { validateMedical };
