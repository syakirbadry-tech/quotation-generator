/**
 * buildPrefillData.js
 *
 * COMPOSE-TIME module - runs inside app.bundle.js, in the agent's
 * browser, right before the client document is composed. Builds the
 * small, explicit prefill object that gets JSON-embedded into the
 * generated client quotation and handed to clientRuntime.js at init
 * time. This is a deliberate allowlist, not the raw parser `data` -
 * the client-runtime bundle must never see parser internals it doesn't
 * need (agent codes, raw benefit tables, warnings, etc.).
 *
 * `data.client` only ever has fullName/gender/dateOfBirth among fields
 * relevant here (see docs/PARSER_API.md) - there is no NRIC, address,
 * employer, income, or beneficiary data anywhere in the parsed PDF, so
 * those fields intentionally start blank for the client to fill in.
 * Unfilled agent contact fields are genuine unknowns (empty string in
 * parser/agents.js), never fabricated here either.
 *
 * Multi-quotation support: an agent may generate 1-3 quotations in one
 * session (see app.js) to let a client compare options. `allData` is an
 * array (length 1-3) of parsed quotation `data` objects in the same
 * order they'll be shown in the comparison; `primaryData` (the one whose
 * client document this prefill is embedded into) drives applicant
 * identity fields. The Plan Selection step in the generated client form
 * picks among `plans` - the REAL generated quotations, never a
 * hardcoded price list.
 */

'use strict';

const { getAgentConfig } = require('../../parser/agents');
const { formatMoneyFixed2, resolveMonthlyTotalPayable, formatDateLong } = require('../../renderer/formatters');

// Reads only data.medical (product-agnostic - see
// parser/normalize/toMedicalJson.js) so this compose-time bundle never
// has to know whether it's looking at an AnugerahMax or Asas360
// quotation. medical.coPayment is already the right field for either
// product's co-payment option string.
function buildRidersList(medical) {
  if (!medical || !medical.riderName) return [];
  const tierPart = medical.planTier ? ` - Plan ${medical.planTier}` : '';
  const coPayPart = medical.coPayment ? ` (${medical.coPayment})` : '';
  return [`${medical.riderName}${tierPart}${coPayPart}`];
}

/** "Monthly Total Amount Payable" - always "RM 246.00" (fixed 2dp), extracted-first with an annual/12 fallback. See renderer/formatters.js. */
function formatMonthlyTotalPayable(contributions, fallbackMonthly) {
  const value = resolveMonthlyTotalPayable(contributions) ?? (fallbackMonthly != null ? fallbackMonthly : null);
  const formatted = formatMoneyFixed2(value);
  return formatted != null ? `RM ${formatted}` : null;
}

function planSummaryFor(d) {
  const contributions = (d && d.contributions) || {};
  const medical = (d && d.medical) || {};
  return {
    planName: medical.planName || null,
    monthlyContribution: formatMonthlyTotalPayable(contributions, d && d.monthlyTotalAmountPayable),
    roomAndBoard: medical.roomAndBoard && medical.roomAndBoard.amount != null ? `RM${medical.roomAndBoard.amount} per day` : null,
    // Exactly one of these is non-null per coverage model - never both, never neither invented.
    annualLimit: medical.annualLimit || medical.lifetimeLimit || null,
    // Phase 5: additive fields for Airtable's "Coverage Model" (single
    // select: "Annual Limit" / "Lifetime Medical Fund") and "Lifetime Fund
    // Amount" (currency) columns - see backend/src/airtable.js.
    // coverageModelLabel intentionally spells out the select option text
    // rather than the internal ANNUAL_LIMIT/LIFETIME_MEDICAL_FUND enum
    // value, since this flows straight into that Airtable field.
    coverageModelLabel:
      medical.coverageModel === 'LIFETIME_MEDICAL_FUND'
        ? 'Lifetime Medical Fund'
        : medical.coverageModel === 'ANNUAL_LIMIT'
        ? 'Annual Limit'
        : null,
    lifetimeFundAmount: medical.lifetimeFundAmount != null ? medical.lifetimeFundAmount : null,
  };
}

/**
 * @param {object|object[]} dataOrArray a single parsed quotation `data` object, or an array of 1-3 (for comparison sessions)
 * @param {object} agentReview { acknowledged, quotationNumber, validUntilIso } as set by the agent in the review step, for the primary/first quotation
 * @returns {object} { quotation, plans, agent, client } - the only things clientRuntime.js is allowed to see
 */
function buildPrefillData(dataOrArray, agentReview) {
  const allData = Array.isArray(dataOrArray) ? dataOrArray : [dataOrArray];
  const d = allData[0] || {};
  const review = agentReview || {};

  const plan = d.plan || {};
  const contributions = d.contributions || {};
  const medical = d.medical || {};
  const metadata = d.metadata || {};
  const client = d.client || {};

  const quotationNumber = review.quotationNumber || (metadata.quotationNumber && metadata.quotationNumber.value) || null;
  const validUntilIso = review.validUntilIso || (metadata.validUntil && metadata.validUntil.iso) || null;

  const agentCfg = getAgentConfig(d.agent && d.agent.agentCode) || {};

  return {
    quotation: {
      quotationNumber,
      validUntil: formatDateLong(validUntilIso),
      // Raw ISO alongside the display string above, so downstream
      // consumers (Airtable's Clients table - see
      // docs/AIRTABLE_FIELD_MAPPING.md) can store it in a real date field
      // instead of re-parsing a human-formatted date.
      validUntilIso: validUntilIso || null,
      // "Base Plan" - AnugerahMax's own basic-plan component name when
      // present (unchanged from before); Asas360 has no equivalent
      // basic-plan concept in Version 1's medical-only scope (see
      // extractors/asas360.js), so the overall product name is shown
      // instead - still accurate, never invented.
      planName: plan.basicPlanName || metadata.productName || null,
      monthlyContribution: formatMonthlyTotalPayable(contributions, d.monthlyTotalAmountPayable),
      riders: buildRidersList(medical),
    },
    // Real generated quotation(s), in comparison order - drives the Plan
    // Selection step's card picker. Length 1 when the agent generated a
    // single quotation (no comparison), 2-3 when they compared options.
    plans: allData.map(planSummaryFor),
    agent: {
      name: agentCfg.name || (d.agent && d.agent.agentNameOnDocument) || null,
      agency: agentCfg.agency || null,
      branch: agentCfg.branch || null,
      phone: agentCfg.phone || '',
      email: agentCfg.email || '',
    },
    client: {
      fullName: client.fullName || null,
      dateOfBirthIso: (client.dateOfBirth && client.dateOfBirth.iso) || null,
      gender: client.gender || null,
    },
    // Phase 5: stamped once, at the moment the agent generates the
    // client document, so models/SubmissionPayload.js can report an
    // honest "generatedAt" in submission metadata without needing the
    // client's local clock (which the document has no other reason to
    // trust) at submit time.
    metadata: {
      generatedAt: new Date().toISOString(),
    },
  };
}

module.exports = { buildPrefillData };
