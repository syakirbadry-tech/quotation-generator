/**
 * validateProtection.js
 *
 * Validates the product-agnostic `data.protection` shape (see
 * normalize/toProtectionJson.js). Warning-only, deliberately - this is a
 * newly-added domain, not a pre-existing hard requirement for either
 * product, so its absence must never turn an otherwise-valid quotation
 * into one with blocking errors. Kept separate from validate.js
 * (AnugerahMax's own frozen required-field validator) and
 * validateMedical.js, matching the same "one file per domain" pattern.
 */

'use strict';

/**
 * @param {object} protection the `data.protection` object produced by normalize/toProtectionJson.js
 * @returns {{ warnings: object[], errors: object[] }}
 */
function validateProtection(protection) {
  const warnings = [];
  const errors = [];

  if (!protection) {
    warnings.push({ field: 'protection', message: 'No normalized protection data was produced for this quotation.' });
    return { warnings, errors };
  }

  if (protection.basicPlanName == null) {
    warnings.push({ field: 'protection.basicPlanName', message: 'Could not determine the basic plan name.' });
  }
  if (protection.basicSumCovered == null) {
    warnings.push({ field: 'protection.basicSumCovered', message: 'Could not determine the basic sum covered.' });
  }
  if (protection.deathBenefit == null) {
    warnings.push({ field: 'protection.deathBenefit', message: 'Could not determine the Death Benefit.' });
  }
  if (protection.tpdBenefit == null) {
    warnings.push({ field: 'protection.tpdBenefit', message: 'Could not determine the TPD Benefit.' });
  }

  return { warnings, errors };
}

module.exports = { validateProtection };
