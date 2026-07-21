/**
 * SubmissionPayload.js
 *
 * CLIENT-RUNTIME model - builds the versioned envelope that
 * SubmissionService hands to a destination adapter. Reuses the existing
 * frozen `application/submission.js`'s `buildSubmission()` internally
 * rather than re-reading form fields itself: that function keeps running
 * completely unmodified, and this file only remaps its output into the
 * new, flatter shape - `client` + `application` (minus beneficiary)
 * become one `applicant` object, and the single `beneficiary` object
 * becomes a `beneficiaries` array. That remap is the "backward
 * compatibility with Phase 4" the payload is required to preserve: the
 * old function/shape is still there and still correct, just wrapped.
 *
 * `parserVersion`/`rendererVersion` can't be read from parser/ or
 * renderer/ - neither module exports a version (and adding one would be
 * a frozen-file change made only for this). These constants instead
 * track the git tags those modules were last frozen at; update them only
 * when parser/ or renderer/ are intentionally re-frozen at a new tag.
 */

'use strict';

const { buildSubmission } = require('../application/submission');

const PARSER_VERSION = 'v1.0-phase1-parser';
const RENDERER_VERSION = 'v1.1-phase2-renderer';
// 1.2 additively extends 1.1 to close gaps found while mapping the payload
// onto the Airtable "Clients" table (the single source of truth - see
// docs/AIRTABLE_FIELD_MAPPING.md): `applicant.race`/`applicant.religion`
// were collected on Step 1 but never left this file; `agent.phone`/
// `agent.email` were available on prefillData.agent but never included;
// `selectedPlan` was only ever a bare plan-name string with no way to
// recover its price/room&board/annual limit if the client picked option 2
// or 3 of a compared set; and the other 1-2 quotations the client actually
// saw (but didn't pick) were never sent at all. Every 1.1 field is still
// present at the same path; nothing was renamed or moved.
const PAYLOAD_VERSION = '1.2';
const SUBMISSION_SOURCE = 'quotation-generator-client-application';

/**
 * Attribution info for the agent who generated this quotation, so
 * Airtable records can be traced back to them. Sourced ONLY from
 * `prefillData.agent` (built by buildPrefillData.js from
 * `getAgentConfig()`) - never re-derives or invents anything. Note
 * `agentCode` is NOT available here: buildPrefillData.js deliberately
 * never exposes it to client-runtime code (see that file's header
 * comment - "the client-runtime bundle must never see parser internals
 * it doesn't need (agent codes, ...)"), so it's correctly absent below
 * rather than fabricated. Each field is included only if it actually has
 * a value - an unknown field is omitted, never sent as a placeholder.
 */
function buildAgentInfo(prefillData) {
  const source = (prefillData && prefillData.agent) || {};
  const agent = {};
  if (source.name) agent.name = source.name;
  if (source.agency) agent.agency = source.agency;
  if (source.branch) agent.branch = source.branch;
  if (source.phone) agent.phone = source.phone;
  if (source.email) agent.email = source.email;
  return agent;
}

/**
 * The full quotation(s) the client was actually shown (1-3, in comparison
 * order) - not just the primary one. Kept verbatim so which options a
 * client compared before choosing is never lost, even though only the
 * primary quotation's own number/validity/riders are surfaced elsewhere
 * in the payload (`quotation`).
 */
function buildPlansCompared(prefillData) {
  return (prefillData && Array.isArray(prefillData.plans)) ? prefillData.plans : [];
}

/**
 * The client's actually-selected plan, resolved back to its full summary
 * (price, room & board, annual limit) - not just the name string stored in
 * `formState.plan`. Matters when a client is shown 2-3 quotations and
 * picks option 2 or 3: the top-level `quotation` object always describes
 * the *primary* (first-generated) quotation, which is only correct by
 * coincidence if the client picked option 1. Falls back to `{ planName }`
 * if no match is found (e.g. a single-plan session) rather than dropping
 * the selection entirely.
 */
function buildSelectedPlanDetails(prefillData, formState) {
  const planName = (formState && formState.plan) || null;
  if (!planName) return null;
  const plans = buildPlansCompared(prefillData);
  const match = plans.find((p) => p.planName === planName);
  return match ? { ...match } : { planName };
}

/** Step 2 (Employment Details) fields beyond the frozen submission.js's `occupation`/`employer`/`annualIncome`. */
function buildEmployment(formState) {
  const f = formState || {};
  return {
    employmentType: f.employmentType || '',
    fieldOfWork: f.fieldOfWork || '',
    employerName: f.employerName || '',
    workAddress: f.workAddress || '',
    monthlyIncome: f.monthlyIncome || '',
  };
}

/** Step 3 (Family Information) - entirely new in the 7-step form, no Phase 4/5 equivalent. */
function buildFamily(formState) {
  const f = formState || {};
  return {
    maritalStatus: f.maritalStatus || '',
    spouseName: f.spouseName || '',
    spouseNric: f.spouseNric || '',
    numChildren: f.numChildren || '',
    childrenDetails: f.childrenDetails || '',
  };
}

/** Step 4 (Medical History) - entirely new in the 7-step form; underwriting-relevant, never inferred/guessed. */
function buildMedicalHistory(formState) {
  const f = formState || {};
  return {
    height: f.height || '',
    weight: f.weight || '',
    smokingStatus: f.smokingStatus || '',
    preExistingConditions: f.preExisting || '',
    currentMedications: f.medications || '',
    allergies: f.allergies || '',
    previousSurgeryOrHospitalisation: f.surgery || '',
  };
}

/** Step 6 (Bank Details) - entirely new in the 7-step form. */
function buildBank(formState) {
  const f = formState || {};
  return {
    bankName: f.bankName || '',
    accountNumber: f.accountNumber || '',
    accountHolderName: f.accountHolderName || '',
  };
}

/**
 * @param {object} prefillData compose-time object from buildPrefillData.js: { quotation, plans, agent, client, metadata? }
 * @param {object} formState merged field values across all 6 application steps (Review excluded)
 * @param {object} documents base64-encoded upload payload from clientRuntime.js: { nricFront?, nricRear?, selfie? }, each { filename, mimeType, base64 }
 * @param {{ submissionId: string }} options a stable id generated once per Review-step entry, reused across retries
 * @returns {object} { version, quotation, agent, applicant, beneficiaries, employment, family, medicalHistory, bank, documents, metadata }
 */
function buildSubmissionPayload(prefillData, formState, documents, options) {
  const { submissionId } = options || {};
  const legacy = buildSubmission(prefillData, formState);
  const { beneficiary, ...applicationRest } = legacy.application;

  const applicant = {
    ...legacy.client,
    ...applicationRest,
    // Step 1 fields the frozen submission.js's buildSubmission() never
    // carried into `client` - added here, not there, so that file stays
    // wrapped rather than modified (see this file's header comment).
    race: (formState && formState.race) || '',
    religion: (formState && formState.religion) || '',
  };

  const beneficiaries = beneficiary && beneficiary.name
    ? [{ ...beneficiary, nric: (formState && formState.beneficiaryNric) || '' }]
    : [];

  const generatedMeta = (prefillData && prefillData.metadata) || {};

  return {
    version: PAYLOAD_VERSION,
    quotation: legacy.quotation,
    plansCompared: buildPlansCompared(prefillData),
    selectedPlan: (formState && formState.plan) || null,
    selectedPlanDetails: buildSelectedPlanDetails(prefillData, formState),
    agent: buildAgentInfo(prefillData),
    applicant,
    beneficiaries,
    employment: buildEmployment(formState),
    family: buildFamily(formState),
    medicalHistory: buildMedicalHistory(formState),
    bank: buildBank(formState),
    documents: documents || {},
    metadata: {
      submissionId: submissionId || null,
      quotationId: (legacy.quotation && legacy.quotation.quotationNumber) || null,
      parserVersion: PARSER_VERSION,
      rendererVersion: RENDERER_VERSION,
      generatedAt: generatedMeta.generatedAt || null,
      submittedAt: new Date().toISOString(),
      product: (legacy.quotation && legacy.quotation.planName) || null,
      source: SUBMISSION_SOURCE,
    },
  };
}

const PruBSNSubmissionPayload = { buildSubmissionPayload, PARSER_VERSION, RENDERER_VERSION, PAYLOAD_VERSION };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PruBSNSubmissionPayload;
}
