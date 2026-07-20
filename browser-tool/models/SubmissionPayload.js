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
const PAYLOAD_VERSION = '1.0';
const SUBMISSION_SOURCE = 'quotation-generator-client-application';

/**
 * @param {object} prefillData compose-time object from buildPrefillData.js: { quotation, agent, client, metadata? }
 * @param {object} formState merged field values across all 4 application steps
 * @param {{ submissionId: string }} options a stable id generated once per Review-step entry, reused across retries
 * @returns {object} { version, quotation, applicant, beneficiaries, metadata }
 */
function buildSubmissionPayload(prefillData, formState, options) {
  const { submissionId } = options || {};
  const legacy = buildSubmission(prefillData, formState);
  const { beneficiary, ...applicationRest } = legacy.application;

  const applicant = {
    ...legacy.client,
    ...applicationRest,
  };

  const beneficiaries = beneficiary && beneficiary.name ? [beneficiary] : [];

  const generatedMeta = (prefillData && prefillData.metadata) || {};

  return {
    version: PAYLOAD_VERSION,
    quotation: legacy.quotation,
    applicant,
    beneficiaries,
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
