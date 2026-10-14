/**
 * airtable.test.js
 *
 * Tests buildClientsFields() (pure - no network) against every section of
 * docs/AIRTABLE_FIELD_MAPPING.md, plus createClientsRecord/uploadAttachment/
 * submitToClientsTable against a mocked global.fetch (never a real
 * Airtable call).
 *
 * Usage: node test/airtable.test.js
 */

import assert from 'node:assert';
import { buildClientsFields, createClientsRecord, uploadAttachment, submitToClientsTable, DOCUMENT_FIELD_IDS } from '../src/airtable.js';

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`  PASS  ${label}`);
    pass++;
  } catch (err) {
    console.log(`  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}
function ok(label, condition) {
  check(label, Boolean(condition), true);
}

const fullPayload = {
  version: '1.2',
  quotation: { quotationNumber: 'Q-1', validUntil: '19 August 2026', validUntilIso: '2026-08-19', monthlyContribution: 'RM 176.00', riders: ['Medic TotalCare - Plan 200'] },
  plansCompared: [{ planName: 'Plan A', monthlyContribution: 'RM 176' }, { planName: 'Plan B', monthlyContribution: 'RM 200' }],
  selectedPlan: 'Plan B',
  selectedPlanDetails: { planName: 'Plan B', monthlyContribution: 'RM 200', roomAndBoard: 'RM 200/day', annualLimit: 'RM200,000', coverageModelLabel: 'Lifetime Medical Fund', lifetimeFundAmount: 1000000 },
  agent: { name: 'Agent Name', agency: 'Agency', branch: 'Branch', phone: '012-3456789', email: 'agent@example.com' },
  applicant: {
    fullName: 'Ahmad Bin Test', nric: '900101-01-1234', dateOfBirth: '1990-01-01', gender: 'Male',
    race: 'Malay', religion: 'Islam', mobileNumber: '012-3456789', email: 'a@example.com', address: '123 Jalan Test',
    occupation: 'Engineer', postcode: '', city: '', state: '', employer: '', annualIncome: '',
  },
  beneficiaries: [{ name: 'Siti Test', relationship: 'Spouse', percentage: '100', nric: '850505-05-5678' }],
  employment: { employmentType: 'Employed', fieldOfWork: 'Software', employerName: 'Acme', workAddress: 'Office', monthlyIncome: '6000' },
  family: { maritalStatus: 'Married', spouseName: 'Jane', spouseNric: '', numChildren: '2', childrenDetails: 'Two kids' },
  medicalHistory: { height: '170', weight: '65', smokingStatus: 'Non-Smoker', preExistingConditions: '', currentMedications: '', allergies: '', previousSurgeryOrHospitalisation: '' },
  bank: { bankName: 'Maybank', accountNumber: '1234567890', accountHolderName: 'Ahmad Bin Test' },
  documents: { nricFront: { filename: 'ic.jpg', mimeType: 'image/jpeg', base64: 'ZmFrZQ==' } },
  metadata: { submissionId: 'sub-1', quotationId: 'Q-1', parserVersion: 'v1.0', rendererVersion: 'v1.1', generatedAt: '2026-07-20T00:00:00.000Z', submittedAt: '2026-07-21T00:00:00.000Z', product: 'PruBSN AnugerahMax', source: 'quotation-generator-client-application' },
};

console.log('=== buildClientsFields: full payload maps every documented section ===');
{
  const fields = buildClientsFields(fullPayload);
  check('Personal Information', {
    'Full Name': fields['Full Name'], NRIC: fields.NRIC, 'Date of Birth': fields['Date of Birth'], Gender: fields.Gender,
    Race: fields.Race, Religion: fields.Religion, Email: fields.Email, 'Phone Number': fields['Phone Number'], 'Residential Address': fields['Residential Address'],
  }, {
    'Full Name': 'Ahmad Bin Test', NRIC: '900101-01-1234', 'Date of Birth': '1990-01-01', Gender: 'Male',
    Race: 'Malay', Religion: 'Islam', Email: 'a@example.com', 'Phone Number': '012-3456789', 'Residential Address': '123 Jalan Test',
  });
  check('Employment', {
    'Employment Type': fields['Employment Type'], Occupation: fields.Occupation, 'Field of Work': fields['Field of Work'],
    "Employer's Name": fields["Employer's Name"], 'Work Place Address': fields['Work Place Address'], 'Monthly Income': fields['Monthly Income'],
  }, {
    'Employment Type': 'Employed', Occupation: 'Engineer', 'Field of Work': 'Software',
    "Employer's Name": 'Acme', 'Work Place Address': 'Office', 'Monthly Income': 6000,
  });
  ok('Monthly Income is coerced to a real number, not the string "6000"', typeof fields['Monthly Income'] === 'number');
  check('Family Information', {
    'Marital Status': fields['Marital Status'], 'Spouse Name': fields['Spouse Name'], 'Number of Children': fields['Number of Children'], 'Children Details': fields['Children Details'],
  }, { 'Marital Status': 'Married', 'Spouse Name': 'Jane', 'Number of Children': 2, 'Children Details': 'Two kids' });
  ok('Spouse NRIC (empty string in payload) is omitted, not sent as ""', !('Spouse NRIC' in fields));
  check('Medical History', {
    'Smoking Status': fields['Smoking Status'], 'Height (cm)': fields['Height (cm)'], 'Weight (kg)': fields['Weight (kg)'],
  }, { 'Smoking Status': 'Non-Smoker', 'Height (cm)': 170, 'Weight (kg)': 65 });
  check('Beneficiary (Plan Selection section)', {
    'Beneficiary Name': fields['Beneficiary Name'], 'Beneficiary NRIC': fields['Beneficiary NRIC'],
    'Beneficiary Relationship': fields['Beneficiary Relationship'], 'Benefit Weightage (%)': fields['Benefit Weightage (%)'],
  }, { 'Beneficiary Name': 'Siti Test', 'Beneficiary NRIC': '850505-05-5678', 'Beneficiary Relationship': 'Spouse', 'Benefit Weightage (%)': 100 });
  check('Selected Plan (resolved to the actually-chosen option, not the primary quotation)', {
    'Selected Plan': fields['Selected Plan'], 'Selected Plan Monthly Contribution': fields['Selected Plan Monthly Contribution'],
    'Selected Plan Room & Board': fields['Selected Plan Room & Board'], 'Selected Plan Annual Limit': fields['Selected Plan Annual Limit'],
  }, { 'Selected Plan': 'Plan B', 'Selected Plan Monthly Contribution': 'RM 200', 'Selected Plan Room & Board': 'RM 200/day', 'Selected Plan Annual Limit': 'RM200,000' });

  // Medical Card Engine Phase 5: additive Coverage Model / Lifetime Fund
  // Amount columns (see buildPrefillData.js's planSummaryFor()).
  check('Coverage Model / Lifetime Fund Amount (Asas360/Health360-style plan)', {
    'Coverage Model': fields['Coverage Model'], 'Lifetime Fund Amount': fields['Lifetime Fund Amount'],
  }, { 'Coverage Model': 'Lifetime Medical Fund', 'Lifetime Fund Amount': 1000000 });
  check('Bank Details', { 'Bank Name': fields['Bank Name'], 'Account Number': fields['Account Number'], 'Account Holder Name': fields['Account Holder Name'] },
    { 'Bank Name': 'Maybank', 'Account Number': '1234567890', 'Account Holder Name': 'Ahmad Bin Test' });
  check('Agent Information (incl. phone/email fixed in payload v1.2)', {
    'Agent Name': fields['Agent Name'], 'Agent Agency': fields['Agent Agency'], 'Agent Branch': fields['Agent Branch'],
    'Agent Phone': fields['Agent Phone'], 'Agent Email': fields['Agent Email'],
  }, { 'Agent Name': 'Agent Name', 'Agent Agency': 'Agency', 'Agent Branch': 'Branch', 'Agent Phone': '012-3456789', 'Agent Email': 'agent@example.com' });
  check('Quotation Information', {
    'Quotation Number': fields['Quotation Number'], 'Quotation Valid Until': fields['Quotation Valid Until'],
    'Quotation Monthly Total Amount Payable': fields['Quotation Monthly Total Amount Payable'], 'Quotation Riders': fields['Quotation Riders'], 'Quotation Product': fields['Quotation Product'],
  }, { 'Quotation Number': 'Q-1', 'Quotation Valid Until': '2026-08-19', 'Quotation Monthly Total Amount Payable': 'RM 176.00', 'Quotation Riders': 'Medic TotalCare - Plan 200', 'Quotation Product': 'PruBSN AnugerahMax' });
  check('Plans Compared is JSON-stringified verbatim', JSON.parse(fields['Plans Compared (JSON)']), fullPayload.plansCompared);
  check('Submission Status defaults to Received on creation (no Automation exists to set this anymore)', fields['Submission Status'], 'Received');
  check('Submission ID / version audit trail', {
    'Submission ID': fields['Submission ID'], 'Parser Version': fields['Parser Version'], 'Renderer Version': fields['Renderer Version'], 'Payload Version': fields['Payload Version'],
  }, { 'Submission ID': 'sub-1', 'Parser Version': 'v1.0', 'Renderer Version': 'v1.1', 'Payload Version': '1.2' });
  ok('Documents are NOT part of the create-record fields object (uploaded separately, see submitToClientsTable)', !('NRIC Front Photo' in fields));
}

console.log('\n=== buildClientsFields: minimal payload never crashes and never invents data ===');
{
  const fields = buildClientsFields({ version: '1.2', metadata: {}, applicant: {}, beneficiaries: [] });
  check('an empty-ish payload produces only the fields it has real data for, plus the one default (Submission Status) and the version it was given', fields, { 'Submission Status': 'Received', 'Payload Version': '1.2' });
}

console.log('\n=== Network calls (mocked fetch - never real Airtable) ===');
{
  const originalFetch = global.fetch;
  const env = { AIRTABLE_PAT: 'fake-pat', AIRTABLE_BASE_ID: 'appFAKE', AIRTABLE_TABLE_ID: 'tblFAKE' };

  try {
    let capturedUrl, capturedBody, capturedAuth;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      capturedAuth = opts.headers.Authorization;
      return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recFAKE123' }] }) };
    };
    const recordId = await createClientsRecord(env, { 'Full Name': 'X' });
    check('createClientsRecord posts to the correct base/table URL', capturedUrl, 'https://api.airtable.com/v0/appFAKE/tblFAKE');
    check('createClientsRecord sends the fields wrapped correctly with typecast enabled', capturedBody, { records: [{ fields: { 'Full Name': 'X' } }], typecast: true });
    ok('the PAT is sent as a Bearer token, never in the URL or body', capturedAuth === 'Bearer fake-pat' && !capturedUrl.includes('fake-pat') && JSON.stringify(capturedBody).indexOf('fake-pat') === -1);
    check('the new record id is returned', recordId, 'recFAKE123');

    global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: { type: 'INVALID_REQUEST_UNKNOWN', message: 'Unknown field name' } }) });
    let threw = null;
    try { await createClientsRecord(env, {}); } catch (e) { threw = e; }
    ok('an Airtable error response throws with the upstream message', threw && threw.message === 'Unknown field name');

    let uploadUrl, uploadBody;
    global.fetch = async (url, opts) => { uploadUrl = url; uploadBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; };
    await uploadAttachment(env, 'recFAKE123', DOCUMENT_FIELD_IDS.nricFront, { filename: 'ic.jpg', mimeType: 'image/jpeg', base64: 'ZmFrZQ==' });
    check('uploadAttachment posts to the correct record+field URL', uploadUrl, `https://content.airtable.com/v0/appFAKE/recFAKE123/${DOCUMENT_FIELD_IDS.nricFront}/uploadAttachment`);
    check('uploadAttachment sends contentType/file/filename', uploadBody, { contentType: 'image/jpeg', file: 'ZmFrZQ==', filename: 'ic.jpg' });

    // submitToClientsTable: create succeeds, one document upload fails - must not fail the whole submission
    let callCount = 0;
    global.fetch = async (url) => {
      callCount++;
      if (url.endsWith('uploadAttachment')) return { ok: false, status: 500, json: async () => ({ error: { message: 'upload failed' } }) };
      return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recFAKE456' }] }) };
    };
    const result = await submitToClientsTable(env, fullPayload);
    check('submitToClientsTable returns the created record id', result.recordId, 'recFAKE456');
    check('a failed attachment upload is reported, not thrown/swallowed', result.attachmentErrors, [{ field: 'nricFront', message: 'upload failed' }]);
    check('exactly 2 calls were made: 1 create-record + 1 attachment (only nricFront was present in fullPayload.documents)', callCount, 2);

    // All 4 documents (3 photos + signature) are uploaded, each to its own field.
    const uploadedFields = [];
    global.fetch = async (url) => {
      if (url.endsWith('uploadAttachment')) { uploadedFields.push(url.split('/').slice(-2)[0]); return { ok: true, status: 200, json: async () => ({}) }; }
      return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recFAKE789' }] }) };
    };
    const doc = { filename: 'x.png', mimeType: 'image/png', base64: 'ZmFrZQ==' };
    const all = await submitToClientsTable(env, { ...fullPayload, documents: { nricFront: doc, nricRear: doc, selfie: doc, signature: doc } });
    check('all 4 documents upload with no errors', all.attachmentErrors, []);
    check('the signature is uploaded to the Signature field along with the 3 photos', uploadedFields.sort(), Object.values(DOCUMENT_FIELD_IDS).sort());
  } finally {
    global.fetch = originalFetch;
  }
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
