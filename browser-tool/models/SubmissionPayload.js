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
// 1.1 additively extends the 1.0 shape with `employment`, `family`,
// `medicalHistory`, `plan`, `bank`, and `documents` - the Phase 7 7-step
// form's fields beyond the original 4-step Phase 4/5 shape. Every 1.0
// field is still present at the same path; nothing was renamed or moved.
const PAYLOAD_VERSION = '1.1';
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
  return agent;
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
  };

  const beneficiaries = beneficiary && beneficiary.name
    ? [{ ...beneficiary, nric: (formState && formState.beneficiaryNric) || '' }]
    : [];

  const generatedMeta = (prefillData && prefillData.metadata) || {};

  return {
    version: PAYLOAD_VERSION,
    quotation: legacy.quotation,
    selectedPlan: (formState && formState.plan) || null,
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
