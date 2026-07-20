/**
 * validation.js
 *
 * CLIENT-RUNTIME module - bundled separately from browser-tool/app.js (see
 * clientRuntime.js and scripts/build-browser-tool.js) and embedded inline
 * into the generated client quotation document. Deliberately has ZERO
 * dependency on parser/ or renderer/ - it only ever operates on plain
 * strings/numbers a real client typed into a form field. Pure functions,
 * no DOM access.
 */

'use strict';

function required(value) {
  return value != null && String(value).trim().length > 0;
}

function isValidEmail(value) {
  if (!value) return false;
  // Deliberately simple (not RFC 5322): good enough to catch obvious
  // typos without rejecting real addresses a stricter regex might miss.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

/**
 * Malaysian mobile numbers: 01X-XXXXXXX or 01X-XXXXXXXX (7 or 8 digits
 * after the 01X prefix), with optional spaces/dashes and an optional
 * leading +60/60.
 */
function isValidMalaysianPhone(value) {
  if (!value) return false;
  const digits = String(value).replace(/[\s-]/g, '').replace(/^\+?60/, '0');
  return /^01\d{8,9}$/.test(digits);
}

/**
 * Malaysian NRIC: YYMMDD-PB-XXXX (6-2-4 digits). Accepts the number with
 * or without dashes and normalizes it for storage/display.
 */
function isValidNRIC(value) {
  if (!value) return false;
  const digits = String(value).replace(/[\s-]/g, '');
  return /^\d{12}$/.test(digits);
}

function formatNRIC(value) {
  const digits = String(value || '').replace(/[\s-]/g, '');
  if (digits.length !== 12) return value || '';
  return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 12)}`;
}

function isValidPercentage(value) {
  if (value === '' || value == null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 100;
}

function isValidPostcode(value) {
  if (!value) return false;
  return /^\d{5}$/.test(String(value).trim());
}

/**
 * Field-level validator registry keyed by field name, used by
 * ApplicationForm.js to decide whether a step can advance. Each entry:
 * { required: boolean, validate?: (value) => boolean, message: string }
 */
const FIELD_RULES = {
  // --- Step 1: Personal Information ---
  fullName: { required: true, message: 'Full name is required.' },
  nric: { required: true, validate: isValidNRIC, message: 'Enter a valid NRIC (e.g. 900101-01-1234).' },
  dateOfBirth: { required: true, message: 'Date of birth is required.' },
  gender: { required: true, message: 'Please select a gender.' },
  race: { required: true, message: 'Please select a race.' },
  religion: { required: true, message: 'Please select a religion.' },
  mobileNumber: { required: true, validate: isValidMalaysianPhone, message: 'Enter a valid Malaysian mobile number (e.g. 012-3456789).' },
  email: { required: true, validate: isValidEmail, message: 'Enter a valid email address.' },
  address: { required: true, message: 'Residential address is required.' },

  // --- Step 2: Employment Details ---
  employmentType: { required: true, message: 'Please select an employment type.' },
  occupation: { required: true, message: 'Occupation is required.' },
  fieldOfWork: { required: false, message: '' },
  employerName: { required: false, message: '' },
  workAddress: { required: false, message: '' },
  monthlyIncome: { required: true, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: 'Enter a valid monthly income.' },
  // Legacy alias kept so an older prefilled/cached value doesn't get silently dropped.
  annualIncome: { required: false, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: 'Enter a valid annual income.' },
  employer: { required: false, message: '' },

  // --- Step 3: Family Information ---
  maritalStatus: { required: true, message: 'Please select a marital status.' },
  spouseName: { required: false, message: '' },
  spouseNric: { required: false, validate: isValidNRIC, message: 'Enter a valid NRIC (e.g. 900101-01-1234).' },
  numChildren: { required: false, validate: (v) => Number.isFinite(Number(v)) && Number(v) >= 0, message: 'Enter a valid number of children.' },
  childrenDetails: { required: false, message: '' },

  // --- Step 4: Medical History ---
  height: { required: true, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: 'Enter a valid height in cm.' },
  weight: { required: true, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: 'Enter a valid weight in kg.' },
  smokingStatus: { required: true, message: 'Please select a smoking status.' },
  preExisting: { required: false, message: '' },
  medications: { required: false, message: '' },
  allergies: { required: false, message: '' },
  surgery: { required: false, message: '' },

  // --- Step 5: Plan Selection + Beneficiary ---
  plan: { required: true, message: 'Please select a plan.' },
  beneficiaryName: { required: true, message: 'Beneficiary name is required.' },
  beneficiaryNric: { required: true, validate: isValidNRIC, message: 'Enter a valid NRIC (e.g. 900101-01-1234).' },
  beneficiaryRelationship: { required: true, message: 'Beneficiary relationship is required.' },
  beneficiaryPercentage: { required: true, validate: isValidPercentage, message: 'Enter a percentage between 1 and 100.' },

  // --- Step 7: Bank Details ---
  bankName: { required: true, message: 'Bank name is required.' },
  accountNumber: { required: true, message: 'Account number is required.' },
  accountHolderName: { required: true, message: 'Account holder name is required.' },

  // Retained for a legacy Address-step shape, unused by the current 7-step layout.
  postcode: { required: false, validate: isValidPostcode, message: 'Enter a valid 5-digit postcode.' },
  city: { required: false, message: 'City is required.' },
  state: { required: false, message: 'Please select a state.' },
};

/** Validates one field by name; returns null if valid, or an error message string. */
function validateField(name, value) {
  const rule = FIELD_RULES[name];
  if (!rule) return null;
  if (rule.required && !required(value)) return rule.message;
  if (required(value) && rule.validate && !rule.validate(value)) return rule.message;
  return null;
}

/** Validates every field name in `names` against `values` (an object); returns { fieldName: message } for failures only. */
function validateFields(names, values) {
  const errors = {};
  for (const name of names) {
    const msg = validateField(name, values[name]);
    if (msg) errors[name] = msg;
  }
  return errors;
}

const PruBSNValidation = {
  required,
  isValidEmail,
  isValidMalaysianPhone,
  isValidNRIC,
  formatNRIC,
  isValidPercentage,
  isValidPostcode,
  validateField,
  validateFields,
  FIELD_RULES,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PruBSNValidation;
}
