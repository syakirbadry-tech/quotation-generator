/**
 * submission.js
 *
 * CLIENT-RUNTIME module - assembles the final submission object shown on
 * the confirmation page. Per spec: "For now NO backend. Instead create a
 * submission object: { quotation, client, application, timestamp }.
 * Display it on the confirmation page. Submission transport can be added
 * in Phase 5." This file only builds that object - it never sends
 * anything anywhere.
 */

'use strict';

/**
 * @param {object} prefillData - the sanitized compose-time prefill object
 *   (quotation/plan/agent summary) inlined into the document by
 *   buildPrefillData.js.
 * @param {object} formState - the client's answers, keyed by field name
 *   across all 4 form steps (fullName, nric, dateOfBirth, gender,
 *   mobileNumber, email, address, postcode, city, state, occupation,
 *   employer, annualIncome, beneficiaryName, beneficiaryRelationship,
 *   beneficiaryPercentage).
 * @returns {object} { quotation, client, application, timestamp }
 */
function buildSubmission(prefillData, formState) {
  const quotation = (prefillData && prefillData.quotation) || {};

  const client = {
    fullName: formState.fullName || '',
    nric: formState.nric || '',
    dateOfBirth: formState.dateOfBirth || '',
    gender: formState.gender || '',
    mobileNumber: formState.mobileNumber || '',
    email: formState.email || '',
  };

  const application = {
    address: formState.address || '',
    postcode: formState.postcode || '',
    city: formState.city || '',
    state: formState.state || '',
    occupation: formState.occupation || '',
    employer: formState.employer || '',
    annualIncome: formState.annualIncome || '',
    beneficiary: {
      name: formState.beneficiaryName || '',
      relationship: formState.beneficiaryRelationship || '',
      percentage: formState.beneficiaryPercentage || '',
    },
  };

  return {
    quotation,
    client,
    application,
    timestamp: new Date().toISOString(),
  };
}

const PruBSNSubmission = { buildSubmission };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PruBSNSubmission;
}
