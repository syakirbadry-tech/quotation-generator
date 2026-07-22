/**
 * normalize/toProtectionJson.js
 *
 * The "protection" domain of the Universal Quotation JSON - basic-plan
 * facts (plan name, term, sum covered) and their guaranteed/non-guaranteed
 * benefits (Death, TPD, Cash Value), kept deliberately SEPARATE from
 * `data.medical` (see normalize/toMedicalJson.js). This is the schema
 * extension the user asked for directly: rather than forcing the Medical
 * Card Engine to also model AnugerahMax/Asas360's basic protection plan
 * (a scope the "medical rider only" Version 1 architecture explicitly
 * excluded), the Universal Quotation JSON now has a separate `protection`
 * section alongside `medical` - each renderer/module decides which
 * sections it needs, and a future Investment/Life/Retirement engine gets
 * its own sibling section the same way, without ever touching this file
 * or toMedicalJson.js.
 *
 * Every field is nullable. A concept a product's own PDF doesn't state as
 * a single figure (e.g. Asas360's Death Benefit is genuinely "Basic Sum
 * Covered plus the cash value of the certificate" - a formula, not a
 * fixed number, since cash value varies by year and investment scenario)
 * is represented as {amount, description} rather than a fabricated total.
 */

'use strict';

/**
 * @param {object} rawData the `data` object from extractors/anugerahmax.js's `extractAnugerahMax()`
 * @returns {object} the `protection` section
 */
function fromAnugerahMax(rawData) {
  const { plan = {}, contributions = {} } = rawData || {};
  const hasDeathTPD = contributions.guaranteedDeathTPDBenefit != null;
  // AnugerahMax's Product Illustration states Death and TPD as ONE
  // combined guaranteed figure ("Guaranteed Death/TPD Benefit") - never
  // split into two separately-quoted amounts, so both fields below
  // honestly share the same {amount, description}, not two invented
  // distinct figures.
  const deathTpd = hasDeathTPD
    ? { amount: contributions.guaranteedDeathTPDBenefit, description: 'Guaranteed Death / Total Permanent Disability Benefit' }
    : null;

  const hasCashValue = contributions.nonGuaranteedCashValueScenarioX != null || contributions.nonGuaranteedCashValueScenarioY != null;

  return {
    basicPlanName: plan.basicPlanName || null,
    basicPlanTerm: plan.basicPlanTerm != null ? plan.basicPlanTerm : null,
    basicSumCovered: plan.basicSumCovered != null ? plan.basicSumCovered : null,
    deathBenefit: deathTpd,
    tpdBenefit: deathTpd,
    cashValue: hasCashValue
      ? {
          scenarioX: contributions.nonGuaranteedCashValueScenarioX != null ? contributions.nonGuaranteedCashValueScenarioX : null,
          scenarioY: contributions.nonGuaranteedCashValueScenarioY != null ? contributions.nonGuaranteedCashValueScenarioY : null,
          // AnugerahMax's PDF states a single non-guaranteed cash value
          // figure per scenario, not a year-by-year schedule - never
          // fabricated here.
          schedule: null,
        }
      : null,
  };
}

/**
 * @param {object} rawData the `data` object from extractors/asas360.js's `extractAsas360()`
 * @returns {object} the `protection` section
 */
function fromAsas360(rawData) {
  const { basicPlan = {} } = rawData || {};

  const hasSchedule = Array.isArray(basicPlan.cashValueSchedule) && basicPlan.cashValueSchedule.length > 0;

  return {
    basicPlanName: basicPlan.basicPlanName || null,
    basicPlanTerm: basicPlan.basicPlanTerm != null ? basicPlan.basicPlanTerm : null,
    basicSumCovered: basicPlan.basicSumCovered != null ? basicPlan.basicSumCovered : null,
    deathBenefit: basicPlan.deathBenefit || null,
    tpdBenefit: basicPlan.tpdBenefit || null,
    cashValue: hasSchedule
      ? {
          // Asas360's investment-linked structure never prints a single
          // "the" cash value - only a year-by-year schedule (Table 1) -
          // so scenarioX/Y stay null here rather than picking one
          // arbitrary year's figure and presenting it as definitive.
          scenarioX: null,
          scenarioY: null,
          schedule: basicPlan.cashValueSchedule,
        }
      : null,
  };
}

module.exports = { fromAnugerahMax, fromAsas360 };
