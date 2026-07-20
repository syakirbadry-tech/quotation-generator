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
const { formatMoney, formatDateLong } = require('../../renderer/formatters');

function buildRidersList(plan) {
  if (!plan || !plan.medicalRiderName) return [];
  const tierPart = plan.medicalPlanTier ? ` - ${plan.medicalPlanTier}` : '';
  const coPayPart = plan.coPaymentOption ? ` (${plan.coPaymentOption})` : '';
  return [`${plan.medicalRiderName}${tierPart}${coPayPart}`];
}

function planSummaryFor(d) {
  const plan = (d && d.plan) || {};
  const contributions = (d && d.contributions) || {};
  const benefits = (d && d.benefits) || {};
  const roomBoardItem = (benefits.benefitItems || []).find((i) => i.label === 'Hospital Daily Room and Board');
  const monthlyContribution = formatMoney(contributions.totalMonthlyContribution);
  return {
    planName: [plan.medicalRiderName, plan.medicalPlanTier].filter(Boolean).join(' ') || plan.basicPlanName || null,
    monthlyContribution: monthlyContribution != null ? `RM ${monthlyContribution}` : null,
    roomAndBoard: roomBoardItem ? roomBoardItem.value : null,
    annualLimit: benefits.annualLimit || null,
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
  const metadata = d.metadata || {};
  const client = d.client || {};

  const quotationNumber = review.quotationNumber || (metadata.quotationNumber && metadata.quotationNumber.value) || null;
  const validUntilIso = review.validUntilIso || (metadata.validUntil && metadata.validUntil.iso) || null;
  const monthlyContribution = formatMoney(contributions.totalMonthlyContribution);

  const agentCfg = getAgentConfig(d.agent && d.agent.agentCode) || {};

  return {
    quotation: {
      quotationNumber,
      validUntil: formatDateLong(validUntilIso),
      planName: plan.basicPlanName || null,
      monthlyContribution: monthlyContribution != null ? `RM ${monthlyContribution}` : null,
      riders: buildRidersList(plan),
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
