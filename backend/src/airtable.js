/**
 * airtable.js
 *
 * Maps a SubmissionPayload v1.2 object (see
 * ../../docs/AIRTABLE_FIELD_MAPPING.md) onto the Clients table's fields,
 * and talks to Airtable's REST API directly. This is the server-side
 * replacement for what the (CORS-incompatible) Airtable Automation
 * webhook was supposed to do - the field mapping itself is unchanged
 * from that document; only the transport is different.
 *
 * Pure mapping logic (buildClientsFields) is exported separately from the
 * network calls so it can be unit-tested without mocking fetch.
 */

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
// Attachment uploads live on a separate host, and their path has no table id:
// POST https://content.airtable.com/v0/{baseId}/{recordId}/{fieldId}/uploadAttachment
const AIRTABLE_CONTENT_BASE = 'https://content.airtable.com/v0';

/** Only include a field if the value is a genuinely non-empty string - never write "" over a real value, and never invent one. */
function str(value) {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

/** Coerces a form-submitted numeric string to a real number; omits the field entirely rather than sending an invalid/empty value to a Number-typed Airtable column. */
function num(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function setIfPresent(fields, name, value) {
  if (value !== undefined) fields[name] = value;
}

/**
 * @param {object} payload a SubmissionPayload v1.2 object (see models/SubmissionPayload.js in the frontend)
 * @returns {object} the Clients table's `fields` object for Airtable's Create Records API
 */
export function buildClientsFields(payload) {
  const p = payload || {};
  const applicant = p.applicant || {};
  const employment = p.employment || {};
  const family = p.family || {};
  const medical = p.medicalHistory || {};
  const bank = p.bank || {};
  const agent = p.agent || {};
  const quotation = p.quotation || {};
  const metadata = p.metadata || {};
  const beneficiary = Array.isArray(p.beneficiaries) && p.beneficiaries.length ? p.beneficiaries[0] : null;
  const selectedPlanDetails = p.selectedPlanDetails || {};

  const fields = {};

  // Personal Information
  setIfPresent(fields, 'Full Name', str(applicant.fullName));
  setIfPresent(fields, 'NRIC', str(applicant.nric));
  setIfPresent(fields, 'Date of Birth', str(applicant.dateOfBirth));
  setIfPresent(fields, 'Gender', str(applicant.gender));
  setIfPresent(fields, 'Race', str(applicant.race));
  setIfPresent(fields, 'Religion', str(applicant.religion));
  setIfPresent(fields, 'Email', str(applicant.email));
  setIfPresent(fields, 'Phone Number', str(applicant.mobileNumber));
  setIfPresent(fields, 'Residential Address', str(applicant.address));

  // Employment
  setIfPresent(fields, 'Employment Type', str(employment.employmentType));
  setIfPresent(fields, 'Occupation', str(applicant.occupation));
  setIfPresent(fields, 'Field of Work', str(employment.fieldOfWork));
  setIfPresent(fields, "Employer's Name", str(employment.employerName));
  setIfPresent(fields, 'Work Place Address', str(employment.workAddress));
  setIfPresent(fields, 'Monthly Income', num(employment.monthlyIncome));

  // Family Information
  setIfPresent(fields, 'Marital Status', str(family.maritalStatus));
  setIfPresent(fields, 'Spouse Name', str(family.spouseName));
  setIfPresent(fields, 'Spouse NRIC', str(family.spouseNric));
  setIfPresent(fields, 'Number of Children', num(family.numChildren));
  setIfPresent(fields, 'Children Details', str(family.childrenDetails));

  // Medical History
  setIfPresent(fields, 'Pre-existing Medical Conditions', str(medical.preExistingConditions));
  setIfPresent(fields, 'Current Medications', str(medical.currentMedications));
  setIfPresent(fields, 'Allergies', str(medical.allergies));
  setIfPresent(fields, 'Previous Surgery/Hospitalization', str(medical.previousSurgeryOrHospitalisation));
  setIfPresent(fields, 'Smoking Status', str(medical.smokingStatus));
  setIfPresent(fields, 'Height (cm)', num(medical.height));
  setIfPresent(fields, 'Weight (kg)', num(medical.weight));

  // Plan Selection (Beneficiary)
  if (beneficiary) {
    setIfPresent(fields, 'Beneficiary Name', str(beneficiary.name));
    setIfPresent(fields, 'Beneficiary NRIC', str(beneficiary.nric));
    setIfPresent(fields, 'Beneficiary Relationship', str(beneficiary.relationship));
    setIfPresent(fields, 'Benefit Weightage (%)', num(beneficiary.percentage));
  }

  // Selected Plan
  setIfPresent(fields, 'Selected Plan', str(p.selectedPlan));
  setIfPresent(fields, 'Selected Plan Monthly Contribution', str(selectedPlanDetails.monthlyContribution));
  setIfPresent(fields, 'Selected Plan Room & Board', str(selectedPlanDetails.roomAndBoard));
  setIfPresent(fields, 'Selected Plan Annual Limit', str(selectedPlanDetails.annualLimit));
  // Additive (Medical Card Engine Phase 5 - see
  // parser/coverageStrategy.js and browser-tool/application/
  // buildPrefillData.js's planSummaryFor()): blank for products/plans
  // that predate this field, never a fabricated default.
  setIfPresent(fields, 'Coverage Model', str(selectedPlanDetails.coverageModelLabel));
  setIfPresent(fields, 'Lifetime Fund Amount', num(selectedPlanDetails.lifetimeFundAmount));

  // Bank Details
  setIfPresent(fields, 'Bank Name', str(bank.bankName));
  setIfPresent(fields, 'Account Number', str(bank.accountNumber));
  setIfPresent(fields, 'Account Holder Name', str(bank.accountHolderName));

  // Agent Information
  setIfPresent(fields, 'Agent Name', str(agent.name));
  setIfPresent(fields, 'Agent Agency', str(agent.agency));
  setIfPresent(fields, 'Agent Branch', str(agent.branch));
  setIfPresent(fields, 'Agent Phone', str(agent.phone));
  setIfPresent(fields, 'Agent Email', str(agent.email));

  // Quotation Information
  setIfPresent(fields, 'Quotation Number', str(quotation.quotationNumber));
  setIfPresent(fields, 'Quotation Valid Until', str(quotation.validUntilIso));
  // Field renamed in Airtable from "Quotation Monthly Contribution" to
  // match the PruBSN Product Illustration's own term for this figure -
  // see docs/AIRTABLE_FIELD_MAPPING.md. The value itself
  // (quotation.monthlyContribution) is already formatted "RM 246.00"
  // (fixed 2dp) by the frontend - see renderer/formatters.js.
  setIfPresent(fields, 'Quotation Monthly Total Amount Payable', str(quotation.monthlyContribution));
  if (Array.isArray(quotation.riders) && quotation.riders.length) {
    fields['Quotation Riders'] = quotation.riders.join('\n');
  }
  setIfPresent(fields, 'Quotation Product', str(metadata.product));
  if (Array.isArray(p.plansCompared) && p.plansCompared.length) {
    fields['Plans Compared (JSON)'] = JSON.stringify(p.plansCompared);
  }

  // Submission Status / audit trail
  setIfPresent(fields, 'Submission ID', str(metadata.submissionId));
  // No Automation in this architecture to apply a default - the worker
  // sets the initial workflow state itself, exactly once, on creation.
  fields['Submission Status'] = 'Received';
  setIfPresent(fields, 'Submitted At', str(metadata.submittedAt));
  setIfPresent(fields, 'Parser Version', str(metadata.parserVersion));
  setIfPresent(fields, 'Renderer Version', str(metadata.rendererVersion));
  setIfPresent(fields, 'Payload Version', str(p.version));

  return fields;
}

function airtableHeaders(env) {
  return {
    Authorization: `Bearer ${env.AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Creates one Clients record. `typecast: true` lets Airtable add a new
 * single-select option on the fly (e.g. Employment Type/Smoking Status
 * values the field's existing choice list doesn't have yet - a caveat
 * the Automation-based approach couldn't work around, documented in
 * docs/AIRTABLE_FIELD_MAPPING.md #1/#2) rather than rejecting the write.
 */
export async function createClientsRecord(env, fields) {
  const url = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_ID)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: airtableHeaders(env),
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body && body.error && (body.error.message || body.error.type)) || `Airtable responded with HTTP ${res.status}`;
    throw Object.assign(new Error(message), { airtableStatus: res.status });
  }
  return body.records[0].id;
}

/**
 * Uploads one base64-encoded document to an existing record's attachment
 * field. Airtable's Create Records API cannot take inline base64 for an
 * attachment field (docs/AIRTABLE_FIELD_MAPPING.md #3) - this dedicated
 * endpoint is the only way to hand it base64 directly, no external
 * hosting/URL required.
 */
export async function uploadAttachment(env, recordId, fieldId, doc) {
  const url = `${AIRTABLE_CONTENT_BASE}/${env.AIRTABLE_BASE_ID}/${recordId}/${fieldId}/uploadAttachment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: airtableHeaders(env),
    body: JSON.stringify({
      contentType: doc.mimeType || 'application/octet-stream',
      file: doc.base64,
      filename: doc.filename || 'document',
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = (body && body.error && (body.error.message || body.error.type)) || `HTTP ${res.status}`;
    throw new Error(message);
  }
}

export const DOCUMENT_FIELD_IDS = {
  nricFront: 'fldcA1s5q4Z0rtiqY',
  nricRear: 'fldHEAMMWfAemuvkz',
  selfie: 'fldRMW9bVDHuQX1Vq',
  signature: 'fld1NfhD4qEcvMZnm',
};

/**
 * Creates the record, then uploads whichever of the 4 documents are
 * present. A document upload failure does not undo or fail the overall
 * submission - the applicant's data already landed on a real record, and
 * making the client redo all 8 steps because one photo upload had a
 * transient error would be worse than a support follow-up to re-attach
 * it. Failures are returned in `attachmentErrors` so the caller can log
 * them, not silently dropped.
 *
 * @returns {Promise<{recordId: string, attachmentErrors: {field: string, message: string}[]}>}
 */
export async function submitToClientsTable(env, payload) {
  const fields = buildClientsFields(payload);
  const recordId = await createClientsRecord(env, fields);

  // Uploaded in parallel so several phone photos fit inside the Worker's Airtable timeout.
  const documents = payload.documents || {};
  const uploads = Object.entries(DOCUMENT_FIELD_IDS)
    .filter(([key]) => documents[key] && documents[key].base64)
    .map(([key, fieldId]) => uploadAttachment(env, recordId, fieldId, documents[key])
      .then(() => null, (err) => ({ field: key, message: err.message })));
  const attachmentErrors = (await Promise.all(uploads)).filter(Boolean);

  return { recordId, attachmentErrors };
}
