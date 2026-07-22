/**
 * validate.js
 *
 * Cross-field validation layer. Runs AFTER all extractors have produced
 * their section of `data` and checks things no single extractor can see
 * on its own: does the monthly figure times 12 equal the annual figure,
 * does the plan tier match the annual limit that was actually printed,
 * are the fields the approved extraction model marked "Required" actually
 * present, etc.
 *
 * Every check reports a WARNING (data looks inconsistent - flag it for
 * the agent to check against the PDF) or an ERROR (a Required field per
 * the approved model is missing outright). Nothing here ever fills in or
 * changes a value - see the file header comment in extractMetadata.js for
 * why "generated" fields like quotationNumber are handled separately and
 * are never treated as validation failures.
 *
 * Returns { warnings: [{field, message}], errors: [{field, message}] }.
 */

'use strict';

// Reference table used ONLY for the plan-tier / annual-limit cross-check
// below - never for extraction. Extend as more plan tiers are observed
// in future PDFs; an unlisted tier is reported as "cannot verify", not
// as a mismatch.
const KNOWN_PLAN_TIER_ANNUAL_LIMITS = {
  'Plan 200': 200000,
};

const REQUIRED_FIELDS = [
  'metadata.productName',
  'metadata.quotationDate',
  'client.fullName',
  'client.gender',
  'client.smokerStatus',
  'client.occupationClass',
  'client.ageNextBirthday',
  'client.dateOfBirth',
  'agent.agentCode',
  'plan.typeOfProduct',
  'plan.basicPlanName',
  'plan.basicPlanTerm',
  'plan.basicSumCovered',
  'plan.medicalRiderName',
  'plan.medicalPlanTier',
  'plan.coPaymentOption',
  'plan.medicalRiderTerm',
  'plan.coverageToAge',
  'contributions.isaContribution',
  'contributions.medicTotalCareContribution',
  'contributions.protectionContribution',
  'contributions.wakalahCertificateCharge',
  'contributions.totalMonthlyContribution',
  'contributions.totalAnnualContribution',
  'contributions.guaranteedDeathTPDBenefit',
  'benefits.annualLimit',
  'benefits.lifetimeLimit',
  'benefits.medicalExclusions',
  'options.columns',
  'options.coverageTerm',
  'projection.projectionRows',
];

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function isEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function checkRequiredFields(data, errors) {
  for (const path of REQUIRED_FIELDS) {
    const empty = isEmpty(getPath(data, path));
    // [DIAGNOSTIC 5] Rule-by-rule trace - every AnugerahMax required-field
    // check this validator runs, PASS or FAIL. This validator only
    // understands data.plan/data.contributions/data.benefits/data.options/
    // data.projection (AnugerahMax's raw extractor shape) - if it is ever
    // invoked against Asas360 data (which has data.medicalRider/
    // data.basicPlan instead), every one of these paths reads as
    // undefined and FAILs, which is exactly the "wall of AnugerahMax
    // messages against an Asas360 upload" symptom this diagnostic exists
    // to catch. See parseQuotation.js normalizeAndValidate()'s isAsas360
    // gate - this validator must never run when isAsas360 is true.
    console.log('[DIAGNOSTIC 5] Rule (AnugerahMax validateQuotation): %s -> %s', path, empty ? 'FAIL' : 'PASS');
    if (empty) {
      errors.push({
        field: path,
        message: `Required field "${path}" is missing or empty. Needs manual entry before this quotation can be sent.`,
      });
    }
  }
}

function checkMonthlyTimesTwelveEqualsAnnual(data, warnings) {
  const monthly = getPath(data, 'contributions.totalMonthlyContribution');
  const annual = getPath(data, 'contributions.totalAnnualContribution');
  if (monthly == null || annual == null) return; // already reported as a required-field error
  const expectedAnnual = Math.round(monthly * 12 * 100) / 100;
  if (Math.abs(expectedAnnual - annual) > 1) {
    warnings.push({
      field: 'contributions.totalAnnualContribution',
      message: `Monthly contribution (RM ${monthly}) x 12 = RM ${expectedAnnual}, which does not match the extracted annual contribution (RM ${annual}).`,
    });
  }
}

/**
 * "Protection Contribution" is a SUBTOTAL of ISA + Medic TotalCare (it's
 * the portion of those two that gets channelled to the Tabarru'/
 * protection fund), not a fifth additive line - the printed "Total
 * Monthly Amount Payable" is ISA + Medic TotalCare + Wakalah Certificate
 * Charge (Protection Contribution is not added again on top of ISA+MTC).
 * For the sample document: ISA 5.00 + MTC 164.00 = Protection 169.00,
 * and 169.00 + Wakalah 7.00 = Total 176.00.
 */
function checkContributionBreakdownSumsToMonthly(data, warnings) {
  const c = data.contributions || {};
  const { isaContribution, medicTotalCareContribution, protectionContribution, wakalahCertificateCharge, totalMonthlyContribution } = c;

  if (isaContribution != null && medicTotalCareContribution != null && protectionContribution != null) {
    const subtotal = Math.round((isaContribution + medicTotalCareContribution) * 100) / 100;
    if (Math.abs(subtotal - protectionContribution) > 0.5) {
      warnings.push({
        field: 'contributions.protectionContribution',
        message: `ISA (RM ${isaContribution}) + Medic TotalCare (RM ${medicTotalCareContribution}) = RM ${subtotal}, which does not match the extracted "Protection Contribution" subtotal (RM ${protectionContribution}).`,
      });
    }
  }

  if (isaContribution != null && medicTotalCareContribution != null && wakalahCertificateCharge != null && totalMonthlyContribution != null) {
    const total = Math.round((isaContribution + medicTotalCareContribution + wakalahCertificateCharge) * 100) / 100;
    if (Math.abs(total - totalMonthlyContribution) > 0.5) {
      warnings.push({
        field: 'contributions.totalMonthlyContribution',
        message: `ISA (RM ${isaContribution}) + Medic TotalCare (RM ${medicTotalCareContribution}) + Wakalah Certificate Charge (RM ${wakalahCertificateCharge}) = RM ${total}, which does not match the extracted total (RM ${totalMonthlyContribution}).`,
      });
    }
  }
}

function checkPlanTierMatchesAnnualLimit(data, warnings) {
  const tier = getPath(data, 'plan.medicalPlanTier');
  const annualLimitRaw = getPath(data, 'benefits.annualLimit');
  if (!tier || !annualLimitRaw) return;
  const expected = KNOWN_PLAN_TIER_ANNUAL_LIMITS[tier];
  if (expected == null) {
    warnings.push({
      field: 'plan.medicalPlanTier',
      message: `"${tier}" is not in the known plan-tier reference table; could not cross-check its annual limit. Add it to KNOWN_PLAN_TIER_ANNUAL_LIMITS in validate.js if this tier is legitimate.`,
    });
    return;
  }
  const actual = parseFloat(String(annualLimitRaw).replace(/[^\d.]/g, ''));
  if (Number.isFinite(actual) && actual !== expected) {
    warnings.push({
      field: 'benefits.annualLimit',
      message: `Plan tier "${tier}" is normally paired with an annual limit of RM ${expected}, but the extracted annual limit is "${annualLimitRaw}".`,
    });
  }
}

function checkCoverageToAgeConsistency(data, warnings) {
  const age = getPath(data, 'client.ageNextBirthday');
  const term = getPath(data, 'plan.basicPlanTerm');
  const coverageToAge = getPath(data, 'plan.coverageToAge');
  if (age == null || term == null || coverageToAge == null) return;
  if (age + term !== coverageToAge) {
    warnings.push({
      field: 'plan.coverageToAge',
      message: `Age (${age}) + basic plan term (${term}) = ${age + term}, which does not match the extracted/derived coverage-to-age (${coverageToAge}).`,
    });
  }
}

function checkDateOfBirthMatchesAge(data, warnings) {
  const dob = getPath(data, 'client.dateOfBirth');
  const ageNextBirthday = getPath(data, 'client.ageNextBirthday');
  const quotationDate = getPath(data, 'metadata.quotationDate');
  if (!dob || ageNextBirthday == null || !quotationDate) return;
  const dobDate = new Date(dob.iso + 'T00:00:00Z');
  const qDate = new Date(quotationDate.iso + 'T00:00:00Z');
  let currentAge = qDate.getUTCFullYear() - dobDate.getUTCFullYear();
  const hadBirthdayThisYear =
    qDate.getUTCMonth() > dobDate.getUTCMonth() ||
    (qDate.getUTCMonth() === dobDate.getUTCMonth() && qDate.getUTCDate() >= dobDate.getUTCDate());
  if (!hadBirthdayThisYear) currentAge -= 1;
  const expectedAgeNextBirthday = currentAge + 1;
  if (Math.abs(expectedAgeNextBirthday - ageNextBirthday) > 1) {
    warnings.push({
      field: 'client.ageNextBirthday',
      message: `Date of birth (${dob.raw}) implies an "age next birthday" of about ${expectedAgeNextBirthday} as of the quotation date, which does not match the extracted value (${ageNextBirthday}).`,
    });
  }
}

function checkBenefitItemsCompleteness(data, warnings) {
  const items = getPath(data, 'benefits.benefitItems');
  if (!Array.isArray(items) || !items.length) return;
  const missing = items.filter((i) => !i.value).map((i) => i.label);
  if (missing.length) {
    warnings.push({
      field: 'benefits.benefitItems',
      message: `${missing.length} of ${items.length} benefit items have no value (${missing.join('; ')}). See per-item warnings for detail.`,
    });
  }
}

function checkOptionsContributionsAreNumbers(data, errors) {
  const columns = getPath(data, 'options.columns');
  if (!Array.isArray(columns)) return;
  columns.forEach((col, i) => {
    if (!Number.isFinite(col.annualContribution) || col.annualContribution <= 0) {
      errors.push({
        field: `options.columns[${i}].annualContribution`,
        message: `"${col.optionLabel}" has no valid annual contribution amount.`,
      });
    }
  });
}

function checkAgentCodeShape(data, warnings) {
  const code = getPath(data, 'agent.agentCode');
  if (!code) return; // already a required-field error
  if (!/^[A-Z0-9]{5,10}$/i.test(code)) {
    warnings.push({
      field: 'agent.agentCode',
      message: `Agent code "${code}" doesn't look like a typical PruBSN agent code; verify it.`,
    });
  }
}

function checkValidUntilAfterQuotationDate(data, errors) {
  const quotationDate = getPath(data, 'metadata.quotationDate');
  const validUntil = getPath(data, 'metadata.validUntil');
  if (!quotationDate || !validUntil) return;
  if (validUntil.iso <= quotationDate.iso) {
    errors.push({
      field: 'metadata.validUntil',
      message: `Generated validUntil date (${validUntil.iso}) is not after the quotation date (${quotationDate.iso}).`,
    });
  }
}

function validateQuotation(data) {
  const warnings = [];
  const errors = [];

  checkRequiredFields(data, errors);
  checkMonthlyTimesTwelveEqualsAnnual(data, warnings);
  checkContributionBreakdownSumsToMonthly(data, warnings);
  checkPlanTierMatchesAnnualLimit(data, warnings);
  checkCoverageToAgeConsistency(data, warnings);
  checkDateOfBirthMatchesAge(data, warnings);
  checkBenefitItemsCompleteness(data, warnings);
  checkOptionsContributionsAreNumbers(data, errors);
  checkAgentCodeShape(data, warnings);
  checkValidUntilAfterQuotationDate(data, errors);

  return { warnings, errors };
}

module.exports = { validateQuotation, KNOWN_PLAN_TIER_ANNUAL_LIMITS, REQUIRED_FIELDS };
