/**
 * ApplicationForm.js
 *
 * CLIENT-RUNTIME module - renders Steps 1-6 of the 7-step client
 * application form (Personal Information, Employment Details, Family
 * Information, Medical History, Plan Selection & Beneficiary, Documents
 * Upload; Bank Details is step 7) mirroring the official "PruBSN Client
 * Form" template's field set and step order. Pure DOM-string rendering +
 * small read/validate helpers; no dependency on parser/ or renderer/.
 * clientRuntime.js owns the stepper chrome (progress indicator, Back/Next
 * buttons); this file only owns the fields inside each step.
 *
 * Two field types get special handling beyond a plain input:
 *   - `file`   - documents upload; the File object itself lives in
 *     clientRuntime.js's `state.files` (never in `values`, which only
 *     ever holds plain strings/numbers), so this module renders the
 *     control and clientRuntime.js wires the change listener + validation.
 *   - `plan-cards` - the Plan Selection step's plan picker is built from
 *     the REAL parsed quotation(s) the agent generated (1-3 of them, via
 *     `context.plans`), not a hardcoded price list - see
 *     buildPrefillData.js. If only one quotation was generated there is
 *     only one card, pre-selectable; if 2-3 were generated (comparison),
 *     the client picks among the actual compared options.
 */

'use strict';

const { validateFields } = require('./validation');

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

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
      { name: 'race', label: 'Race', type: 'select', options: ['Malay', 'Chinese', 'Indian', 'Others'] },
      { name: 'religion', label: 'Religion', type: 'select', options: ['Islam', 'Christianity', 'Buddhism', 'Hinduism', 'Others'] },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'name@example.com' },
      { name: 'mobileNumber', label: 'Phone Number', type: 'tel', placeholder: '012-3456789' },
      { name: 'address', label: 'Residential Address', type: 'textarea' },
    ],
  },
  {
    id: 'employment',
    title: 'Employment Details',
    subtitle: 'A few details about your work.',
    fields: [
      { name: 'employmentType', label: 'Employment Type', type: 'select', options: ['Employed', 'Self-Employed', 'Business Owner', 'Unemployed', 'Retired', 'Student'] },
      { name: 'occupation', label: 'Occupation', type: 'text' },
      { name: 'fieldOfWork', label: 'Field of Work', type: 'text', optional: true },
      { name: 'employerName', label: "Employer's Name", type: 'text', optional: true },
      { name: 'monthlyIncome', label: 'Monthly Income (RM)', type: 'number', placeholder: '5000' },
      { name: 'workAddress', label: 'Work Place Address', type: 'textarea', optional: true },
    ],
  },
  {
    id: 'family',
    title: 'Family Information',
    subtitle: 'Tell us about your immediate family.',
    fields: [
      { name: 'maritalStatus', label: 'Marital Status', type: 'select', options: ['Single', 'Married', 'Divorced', 'Widowed'] },
      { name: 'spouseName', label: 'Spouse Name', type: 'text', optional: true },
      { name: 'spouseNric', label: 'Spouse NRIC', type: 'text', placeholder: '900101-01-1234', optional: true },
      { name: 'numChildren', label: 'Number of Children', type: 'number', optional: true },
      { name: 'childrenDetails', label: 'Children Details', type: 'textarea', optional: true },
    ],
  },
  {
    id: 'medical',
    title: 'Medical History',
    subtitle: 'This helps underwriting assess your application accurately.',
    fields: [
      { name: 'height', label: 'Height (cm)', type: 'number', placeholder: '170' },
      { name: 'weight', label: 'Weight (kg)', type: 'number', placeholder: '65' },
      { name: 'smokingStatus', label: 'Smoking Status', type: 'select', options: ['Non-Smoker', 'Smoker', 'Former Smoker'] },
      { name: 'preExisting', label: 'Pre-existing Medical Conditions', type: 'textarea', optional: true, placeholder: 'None, if not applicable' },
      { name: 'medications', label: 'Current Medications', type: 'textarea', optional: true, placeholder: 'None, if not applicable' },
      { name: 'allergies', label: 'Allergies', type: 'textarea', optional: true, placeholder: 'None, if not applicable' },
      { name: 'surgery', label: 'Previous Surgery / Hospitalisation', type: 'textarea', optional: true, placeholder: 'None, if not applicable' },
    ],
  },
  {
    id: 'plan',
    title: 'Plan Selection',
    subtitle: 'Choose the plan you would like to proceed with, and tell us who should receive the benefit.',
    fields: [
      { name: 'plan', label: 'Plan', type: 'plan-cards' },
      { name: 'beneficiaryName', label: 'Beneficiary Name', type: 'text' },
      { name: 'beneficiaryNric', label: 'Beneficiary NRIC', type: 'text', placeholder: '900101-01-1234' },
      { name: 'beneficiaryRelationship', label: 'Relationship', type: 'text', placeholder: 'e.g. Spouse, Child, Parent' },
      { name: 'beneficiaryPercentage', label: 'Benefit Weightage (%)', type: 'number', placeholder: '100' },
    ],
  },
  {
    id: 'documents',
    title: 'Documents Upload',
    subtitle: 'Upload clear photos so your agent can verify your identity.',
    fields: [
      { name: 'nricFront', label: 'NRIC Front Photo', type: 'file' },
      { name: 'nricRear', label: 'NRIC Rear Photo', type: 'file' },
      { name: 'selfie', label: 'Selfie with IC Photo', type: 'file' },
    ],
  },
  {
    id: 'bank',
    title: 'Bank Details',
    subtitle: 'Where should refunds or payouts be sent?',
    fields: [
      { name: 'bankName', label: 'Bank Name', type: 'text' },
      { name: 'accountNumber', label: 'Account Number', type: 'text' },
      { name: 'accountHolderName', label: 'Account Holder Name', type: 'text' },
    ],
  },
];

const TOTAL_STEPS = STEP_DEFS.length;
const DOCUMENTS_STEP_INDEX = STEP_DEFS.findIndex((s) => s.id === 'documents');
const PLAN_STEP_INDEX = STEP_DEFS.findIndex((s) => s.id === 'plan');

/**
 * Field names on a step that should be read from/written to a rendered
 * `<input>`/`<select>`/`<textarea>` via `[name=...]` + `.value`. Excludes
 * `file` fields (live in `state.files`, no `.value` reflects a real file)
 * and `plan-cards` (no single form control - clientRuntime.js's click
 * handler writes `state.values.plan` directly; collecting it here would
 * find no `[name="plan"]` element and overwrite that value with '').
 */
function stepFieldNames(stepIndex) {
  const step = STEP_DEFS[stepIndex];
  return step ? step.fields.filter((f) => f.type !== 'file' && f.type !== 'plan-cards').map((f) => f.name) : [];
}

/** File field names on a step (currently only the Documents step has any). */
function stepFileFieldNames(stepIndex) {
  const step = STEP_DEFS[stepIndex];
  return step ? step.fields.filter((f) => f.type === 'file').map((f) => f.name) : [];
}

function fieldHtml(field, value, error) {
  const id = `paf-field-${field.name}`;
  const errorId = `${id}-error`;
  const commonAttrs = `id="${id}" name="${field.name}" class="paf-input${error ? ' paf-input-error' : ''}"` +
    (field.autocomplete ? ` autocomplete="${field.autocomplete}"` : '') +
    (field.optional ? '' : ' aria-required="true"') +
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

  // Textarea fields span the full grid width. Done with an explicit class
  // here (not just the CSS ":has(textarea)" rule in composeClientDocument.js)
  // because :has() has no effect in browsers that don't support it
  // (Firefox before v121/2023, older Safari/mobile WebViews) - the class
  // keeps the layout correct there too instead of silently degrading to a
  // half-width, cramped address/notes box.
  const wideClass = field.type === 'textarea' ? ' paf-field-wide' : '';

  return `
    <div class="paf-field${wideClass}">
      <label class="paf-label" for="${id}">${escapeHtml(field.label)}${field.optional ? ' <span class="paf-optional">(optional)</span>' : ''}</label>
      ${control}
      ${error ? `<div class="paf-error" id="${errorId}">${escapeHtml(error)}</div>` : ''}
    </div>`;
}

function fileFieldHtml(field, file, error) {
  const hasFile = !!file;
  return `
    <div class="paf-field paf-file-field">
      <label class="paf-label" for="paf-file-${field.name}">${escapeHtml(field.label)}</label>
      <label class="paf-upload${hasFile ? ' paf-upload-done' : ''}${error ? ' paf-input-error' : ''}" for="paf-file-${field.name}">
        <span class="paf-upload-icon" aria-hidden="true">${hasFile ? '&#10003;' : '+'}</span>
        <span class="paf-upload-text">${hasFile ? escapeHtml(file.name) : 'Click to upload &mdash; JPG, PNG, or PDF (max 5MB)'}</span>
      </label>
      <input type="file" id="paf-file-${field.name}" name="${field.name}" class="paf-upload-input" data-file-field="${field.name}" accept="image/*,.pdf">
      ${error ? `<div class="paf-error">${escapeHtml(error)}</div>` : ''}
    </div>`;
}

/** Renders the Plan Selection step's card picker from the agent's real generated quotation(s) - never a hardcoded price list. */
function planCardsHtml(plans, selectedIndex, error) {
  const list = Array.isArray(plans) && plans.length ? plans : [];
  if (!list.length) {
    return `<div class="paf-plan-empty">Your agent has not attached a plan to this application yet.</div>`;
  }
  const cards = list.map((p, i) => {
    const picked = selectedIndex === i;
    return `
      <div class="paf-plan-card${picked ? ' paf-plan-card-picked' : ''}" data-plan-index="${i}" role="button" tabindex="0">
        ${list.length > 1 && i === 0 ? '<div class="paf-plan-badge">Recommended</div>' : ''}
        <div class="paf-plan-name">${escapeHtml(p.planName || `Option ${i + 1}`)}</div>
        <div class="paf-plan-price">${p.monthlyContribution ? escapeHtml(p.monthlyContribution) : '&mdash;'}<small>/mo</small></div>
        <div class="paf-plan-meta">${[p.roomAndBoard, p.annualLimit].filter(Boolean).map(escapeHtml).join(' &middot; ')}</div>
      </div>`;
  }).join('');
  return `<div class="paf-plan-cards" data-field="plan">${cards}</div>${error ? `<div class="paf-error">${escapeHtml(error)}</div>` : ''}`;
}

/**
 * @param {number} stepIndex 0-based index into STEP_DEFS
 * @param {object} values current form state (all steps merged, plain values only)
 * @param {object} errors { fieldName: message } for fields on this step only
 * @param {object} context extra render-only data: { files, plans }
 * @returns {string} HTML for the step's heading + fields (no chrome/nav)
 */
function renderStepHtml(stepIndex, values, errors, context) {
  const step = STEP_DEFS[stepIndex];
  if (!step) return '';
  const files = (context && context.files) || {};
  const plans = (context && context.plans) || [];
  const errs = errors || {};

  const fieldsHtml = step.fields.map((f) => {
    if (f.type === 'file') return fileFieldHtml(f, files[f.name], errs[f.name]);
    if (f.type === 'plan-cards') {
      const selectedIndex = plans.findIndex((p) => p.planName === values.plan);
      return planCardsHtml(plans, selectedIndex === -1 ? null : selectedIndex, errs.plan);
    }
    return fieldHtml(f, values[f.name] || '', errs[f.name]);
  }).join('');

  return `
    <div class="paf-step" data-step-id="${step.id}">
      <h3 class="paf-step-title">${escapeHtml(step.title)}</h3>
      <p class="paf-step-subtitle">${escapeHtml(step.subtitle)}</p>
      <div class="paf-fields">${fieldsHtml}</div>
    </div>`;
}

/** Reads current input values for one step out of a container element (skips `file` fields - see stepFileFieldNames). */
function collectStepValues(stepIndex, containerEl) {
  const names = stepFieldNames(stepIndex);
  const values = {};
  for (const name of names) {
    const el = containerEl.querySelector(`[name="${name}"]`);
    values[name] = el ? el.value : '';
  }
  return values;
}

/** Validates one step's plain-value fields; file-field presence is validated separately by clientRuntime.js against `state.files`. */
function validateStep(stepIndex, values) {
  return validateFields(stepFieldNames(stepIndex), values);
}

const PruBSNApplicationForm = {
  STEP_DEFS,
  TOTAL_STEPS,
  DOCUMENTS_STEP_INDEX,
  PLAN_STEP_INDEX,
  stepFieldNames,
  stepFileFieldNames,
  renderStepHtml,
  collectStepValues,
  validateStep,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PruBSNApplicationForm;
}
