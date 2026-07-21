/**
 * normalize/toMedicalJson.js
 *
 * Phase 1/2 of the Medical Card Engine's Version 1 architecture (see
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md). Two pure mapper
 * functions - `fromAnugerahMax()` and `fromAsas360()` - that both produce
 * the SAME `medical.*` shape from each product extractor's own raw
 * output, so the renderer never has to know which product it's looking
 * at or branch on a product-specific field name.
 *
 * Every field is nullable. A concept that doesn't apply to a given
 * product (e.g. `lifetimeFundAmount` for AnugerahMax, `annualLimit` for
 * Asas360) is `null` - never a fabricated placeholder. Where a source PDF
 * genuinely doesn't print a figure a field would otherwise hold (e.g.
 * Asas360/Health360 has no standalone monthly contribution line - see
 * `fromAsas360()`'s own comment), a warning is added rather than
 * inventing or deriving a number the document doesn't state.
 *
 * This file contains NO PDF-parsing/anchor logic of its own - it only
 * reshapes data each extractor already found. Small presentation-adjacent
 * helpers here (pulling an RM amount or a day-count out of an already-
 * extracted benefit value string) mirror the same kind of interpretation
 * extractContributions.js and formatters.js already do elsewhere in this
 * project on already-extracted text - never a second PDF-reading pass.
 */

'use strict';

/** Strips a "Plan " prefix, e.g. "Plan 200" -> "200". Mirrors renderer/formatters.js's bareTierNumber() - duplicated, not imported, since parser/ must never depend on renderer/. */
function bareTierNumber(planTier) {
  if (!planTier) return null;
  return String(planTier).replace(/^Plan\s+/i, '');
}

/** Pulls "RM200" out of "RM200 per day (maximum 150 days per rider year)". */
function extractRmAmount(value) {
  if (!value) return null;
  const m = String(value).match(/RM\s*([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** Pulls 150 out of "(maximum 150 days per rider year)" / "(maximum 150 days per year)". */
function extractMaxDays(value) {
  if (!value) return null;
  const m = String(value).match(/maximum\s+(\d+)\s+days/i);
  return m ? Number(m[1]) : null;
}

function findBenefit(benefitItems, label) {
  return (benefitItems || []).find((b) => b.label === label) || null;
}

/**
 * @param {object} rawData the `data` object from extractors/anugerahmax.js's `extractAnugerahMax()`
 * @returns {object} the `medical` section - ANNUAL_LIMIT coverage model
 */
function fromAnugerahMax(rawData, warnings = []) {
  const { metadata = {}, plan = {}, contributions = {}, benefits = {} } = rawData || {};
  const benefitItems = benefits.benefitItems || [];
  const roomBoardItem = findBenefit(benefitItems, 'Hospital Daily Room and Board');

  return {
    productName: metadata.productName || null,
    riderName: plan.medicalRiderName || null,
    planName: [plan.medicalRiderName, plan.medicalPlanTier].filter(Boolean).join(' ') || null,
    planTier: bareTierNumber(plan.medicalPlanTier),
    coverageModel: 'ANNUAL_LIMIT',
    annualLimit: benefits.annualLimit || null,
    lifetimeFundAmount: null,
    costSharingAfterExhaustion: null,
    lifetimeLimit: benefits.lifetimeLimit || null,
    roomAndBoard: roomBoardItem
      ? { amount: extractRmAmount(roomBoardItem.value), maxDaysPerYear: extractMaxDays(roomBoardItem.value) }
      : null,
    coPayment: plan.coPaymentOption || null,
    coverageToAge: plan.coverageToAge != null ? plan.coverageToAge : null,
    contribution: contributions.medicTotalCareContribution != null ? contributions.medicTotalCareContribution : null,
    benefitItems,
    medicalExclusions: benefits.medicalExclusions || [],
    fullExclusionsList: benefits.fullExclusionsList || [],
    waitingPeriods: benefits.waitingPeriods || [],
  };
}

/**
 * @param {object} rawData the `data` object from extractors/asas360.js's `extractAsas360()`
 * @returns {object} the `medical` section - LIFETIME_MEDICAL_FUND coverage model
 */
function fromAsas360(rawData, warnings = []) {
  const { metadata = {}, medicalRider = {} } = rawData || {};
  const benefitItems = medicalRider.benefitItems || [];
  const roomBoardItem = findBenefit(benefitItems, 'Hospital Daily Room & Board');

  if (medicalRider.contribution == null) {
    warnings.push({
      field: 'medical.contribution',
      message: 'PruBSN Asas360 quotations do not print a standalone monthly contribution figure for the Health360 rider - it is bundled into the combined "Protection Contribution + Allocator Contribution" line. Not derived/estimated - see Table 3\'s Tabarru\' deduction schedule (medical.tabarruDeductionSchedule) for the real, printed per-year Health360-specific cost instead.',
    });
  }

  return {
    productName: metadata.productName || null,
    riderName: medicalRider.riderName || null,
    planName: [medicalRider.riderName, medicalRider.planTier ? `Plan ${medicalRider.planTier}` : null].filter(Boolean).join(' ') || null,
    planTier: medicalRider.planTier || null,
    coverageModel: 'LIFETIME_MEDICAL_FUND',
    annualLimit: null,
    lifetimeFundAmount: medicalRider.smartValuePoint != null ? medicalRider.smartValuePoint : null,
    costSharingAfterExhaustion: medicalRider.smartValuePoint != null ? { insurerPct: 80, clientPct: 20 } : null,
    lifetimeLimit: medicalRider.lifetimeLimit || null,
    roomAndBoard: roomBoardItem
      ? { amount: extractRmAmount(roomBoardItem.value), maxDaysPerYear: extractMaxDays(roomBoardItem.value) }
      : null,
    coPayment: medicalRider.coPaymentOption || null,
    coverageToAge: medicalRider.coverageToAge != null ? medicalRider.coverageToAge : null,
    contribution: medicalRider.contribution != null ? medicalRider.contribution : null,
    tabarruDeductionSchedule: medicalRider.tabarruDeductionSchedule || null,
    benefitItems,
    medicalExclusions: medicalRider.medicalExclusions || [],
    fullExclusionsList: medicalRider.fullExclusionsList || [],
    waitingPeriods: medicalRider.waitingPeriods || [],
  };
}

module.exports = { fromAnugerahMax, fromAsas360 };
