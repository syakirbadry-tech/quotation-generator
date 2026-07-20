/**
 * ApplicationForm.js
 *
 * CLIENT-RUNTIME module - renders Steps 1-4 of the client application
 * form (Personal Information, Address, Employment, Beneficiary) and
 * validates each step before allowing "Next". Pure DOM-string rendering
 * + small read/validate helpers; no dependency on parser/ or renderer/.
 * clientRuntime.js owns the stepper chrome (progress indicator, Back/Next
 * buttons); this file only owns the fields inside each step.
 */

'use strict';

const { validateFields } = require('./validation');

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

const MALAYSIAN_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak',
  'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu',
  'Wilayah Persekutuan Kuala Lumpur', 'Wilayah Persekutuan Labuan', 'Wilayah Persekutuan Putrajaya',
];

const STEP_DEFS = [
  {
    id: 'personal',
    title: 'Personal Information',
    subtitle: 'Tell us a little about yourself.',
    fields: [
      { name: 'fullName', label: 'Full Name', type: 'text', autocomplete: 'name' },
      { name: 'nric', label: 'NRIC', type: 'text', placeholder: '900101-01-1234' },
      { name: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
      { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female'] },
      { name: 'mobileNumber', label: 'Mobile Number', type: 'tel', placeholder: '012-3456789' },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'name@example.com' },
    ],
  },
  {
    id: 'address',
    title: 'Address',
    subtitle: 'Where can we reach you by post?',
    fields: [
      { name: 'address', label: 'Address', type: 'textarea' },
      { name: 'postcode', label: 'Postcode', type: 'text', placeholder: '05100' },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'state', label: 'State', type: 'select', options: MALAYSIAN_STATES },
    ],
  },
  {
    id: 'employment',
    title: 'Employment',
    subtitle: 'A few details about your work.',
    fields: [
      { name: 'occupation', label: 'Occupation', type: 'text' },
      { name: 'employer', label: 'Employer', type: 'text', optional: true },
      { name: 'annualIncome', label: 'Annual Income (RM)', type: 'number', placeholder: '60000' },
    ],
  },
  {
    id: 'beneficiary',
    title: 'Beneficiary',
    subtitle: 'Who should receive the benefit payout?',
    fields: [
      { name: 'beneficiaryName', label: 'Beneficiary Name', type: 'text' },
      { name: 'beneficiaryRelationship', label: 'Relationship', type: 'text', placeholder: 'e.g. Spouse, Child, Parent' },
      { name: 'beneficiaryPercentage', label: 'Percentage (%)', type: 'number', placeholder: '100' },
    ],
  },
];

const TOTAL_STEPS = STEP_DEFS.length;

function stepFieldNames(stepIndex) {
  const step = STEP_DEFS[stepIndex];
  return step ? step.fields.map((f) => f.name) : [];
}

function fieldHtml(field, value, error) {
  const id = `paf-field-${field.name}`;
  const errorId = `${id}-error`;
  const commonAttrs = `id="${id}" name="${field.name}" class="paf-input${error ? ' paf-input-error' : ''}"` +
    (field.autocomplete ? ` autocomplete="${field.autocomplete}"` : '') +
    (error ? ` aria-invalid="true" aria-describedby="${errorId}"` : '');

  let control;
  if (field.type === 'select') {
    const options = field.options
      .map((opt) => `<option value="${escapeHtml(opt)}"${value === opt ? ' selected' : ''}>${escapeHtml(opt)}</option>`)
      .join('');
    control = `<select ${commonAttrs}><option value="">Select...</option>${options}</select>`;
  } else if (field.type === 'textarea') {
    control = `<textarea ${commonAttrs} rows="3" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(value)}</textarea>`;
  } else {
    control = `<input type="${field.type}" ${commonAttrs} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || '')}">`;
  }

  return `
    <div class="paf-field">
      <label class="paf-label" for="${id}">${escapeHtml(field.label)}${field.optional ? ' <span class="paf-optional">(optional)</span>' : ''}</label>
      ${control}
      ${error ? `<div class="paf-error" id="${errorId}">${escapeHtml(error)}</div>` : ''}
    </div>`;
}

/**
 * @param {number} stepIndex 0-based index into STEP_DEFS
 * @param {object} values current form state (all steps merged)
 * @param {object} errors { fieldName: message } for fields on this step only
 * @returns {string} HTML for the step's heading + fields (no chrome/nav)
 */
function renderStepHtml(stepIndex, values, errors) {
  const step = STEP_DEFS[stepIndex];
  if (!step) return '';
  const fieldsHtml = step.fields.map((f) => fieldHtml(f, values[f.name] || '', (errors || {})[f.name])).join('');
  return `
    <div class="paf-step" data-step-id="${step.id}">
      <h3 class="paf-step-title">${escapeHtml(step.title)}</h3>
      <p class="paf-step-subtitle">${escapeHtml(step.subtitle)}</p>
      <div class="paf-fields">${fieldsHtml}</div>
    </div>`;
}

/** Reads current input values for one step out of a container element. */
function collectStepValues(stepIndex, containerEl) {
  const names = stepFieldNames(stepIndex);
  const values = {};
  for (const name of names) {
    const el = containerEl.querySelector(`[name="${name}"]`);
    values[name] = el ? el.value : '';
  }
  return values;
}

/** Validates one step's fields against the current merged form state; returns { fieldName: message }. */
function validateStep(stepIndex, values) {
  return validateFields(stepFieldNames(stepIndex), values);
}

const PruBSNApplicationForm = {
  STEP_DEFS,
  TOTAL_STEPS,
  MALAYSIAN_STATES,
  stepFieldNames,
  renderStepHtml,
  collectStepValues,
  validateStep,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PruBSNApplicationForm;
}
