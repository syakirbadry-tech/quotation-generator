/**
 * app.js
 *
 * Browser tool application logic. This is the only file in the project
 * that wires the frozen parser and the Phase 2 renderer together behind
 * a UI - it contains no parsing logic of its own (that's
 * pdfTextSource.browser.js + parser/*) and no rendering-template logic
 * of its own (that's renderer/renderQuotation.js). Its job is state
 * management: upload -> parse -> agent review/edit -> confirm ->
 * generate -> download.
 *
 * Privacy: everything below runs entirely client-side. The PDF is read
 * via FileReader, parsed via pdf.js (vendored, not a CDN), and never
 * leaves the browser - there is no fetch/XHR/WebSocket anywhere in this
 * file or anything it calls.
 */

'use strict';

const { extractPagesFromPdf } = require('./pdfTextSource.browser.js');
const { parseQuotation } = require('../parser/index.js');
const { validateQuotation } = require('../parser/validate.js');
const { renderAgentReviewHtml, renderClientQuotationHtml } = require('../renderer/renderQuotation.js');

// --- Editable field registry -------------------------------------------
// One entry per scalar field an agent can hand-correct. `path` is a
// dot-path into state.data; `label` is what's shown in the review form.
// Deliberately covers every Required field from the approved extraction
// model (see docs/PARSER_API.md) plus a few useful non-required ones -
// array fields (benefitItems, options.columns) get their own table
// renderers below instead of appearing here.
const EDITABLE_FIELDS = [
  { section: 'Metadata', path: 'metadata.productName', label: 'Product name' },
  { section: 'Metadata', path: 'metadata.quotationDate.raw', label: 'Quotation date (as printed, DD/MM/YYYY)' },
  { section: 'Client', path: 'client.fullName', label: 'Full name' },
  { section: 'Client', path: 'client.gender', label: 'Gender' },
  { section: 'Client', path: 'client.smokerStatus', label: 'Smoker status' },
  { section: 'Client', path: 'client.occupationClass', label: 'Occupation class' },
  { section: 'Client', path: 'client.ageNextBirthday', label: 'Age next birthday', type: 'number' },
  { section: 'Client', path: 'client.dateOfBirth.raw', label: 'Date of birth (DD/MM/YYYY)' },
  { section: 'Agent', path: 'agent.agentCode', label: 'Agent code (drives agency/branch/contact lookup)' },
  { section: 'Agent', path: 'agent.agentNameOnDocument', label: 'Agent name (as printed on PDF)' },
  { section: 'Plan', path: 'plan.typeOfProduct', label: 'Type of product' },
  { section: 'Plan', path: 'plan.basicPlanName', label: 'Basic plan name' },
  { section: 'Plan', path: 'plan.basicPlanTerm', label: 'Basic plan term (years)', type: 'number' },
  { section: 'Plan', path: 'plan.basicSumCovered', label: 'Basic sum covered (RM)', type: 'number' },
  { section: 'Plan', path: 'plan.medicalRiderName', label: 'Medical rider name' },
  { section: 'Plan', path: 'plan.medicalPlanTier', label: 'Medical plan tier' },
  { section: 'Plan', path: 'plan.coPaymentOption', label: 'Co-payment option' },
  { section: 'Plan', path: 'plan.medicalRiderTerm', label: 'Medical rider term (years)', type: 'number' },
  { section: 'Plan', path: 'plan.coverageToAge', label: 'Coverage to age', type: 'number' },
  { section: 'Contributions', path: 'contributions.isaContribution', label: 'ISA contribution (RM)', type: 'number' },
  { section: 'Contributions', path: 'contributions.medicTotalCareContribution', label: 'Medic TotalCare contribution (RM)', type: 'number' },
  { section: 'Contributions', path: 'contributions.protectionContribution', label: 'Protection contribution (RM)', type: 'number' },
  { section: 'Contributions', path: 'contributions.wakalahCertificateCharge', label: 'Wakalah certificate charge (RM)', type: 'number' },
  { section: 'Contributions', path: 'contributions.totalMonthlyContribution', label: 'Total monthly contribution (RM)', type: 'number' },
  { section: 'Contributions', path: 'contributions.totalAnnualContribution', label: 'Total annual contribution (RM)', type: 'number' },
  { section: 'Contributions', path: 'contributions.guaranteedDeathTPDBenefit', label: 'Guaranteed death/TPD benefit (RM)', type: 'number' },
  { section: 'Benefits', path: 'benefits.annualLimit', label: 'Annual limit' },
  { section: 'Benefits', path: 'benefits.lifetimeLimit', label: 'Lifetime limit' },
  { section: 'Options', path: 'options.coverageTerm', label: 'Options table coverage term' },
];

// --- Path helpers --------------------------------------------------------

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor[keys[i]] == null) cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
}

function warningsForPath(warnings, path) {
  return warnings.filter((w) => w.field === path || w.field.startsWith(path + '.'));
}

function errorsForPath(errors, path) {
  return errors.filter((e) => e.field === path || e.field.startsWith(path + '.'));
}

// --- Application state ---------------------------------------------------

const state = {
  stage: 'upload', // upload | parsing | review | error
  fileName: null,
  data: null,
  warnings: [],
  errors: [],
  reviewAcknowledged: false,
  quotationNumber: '',
  validUntilIso: '',
};

// --- DOM ------------------------------------------------------------------

const el = {
  uploadStage: document.getElementById('stage-upload'),
  reviewStage: document.getElementById('stage-review'),
  fileInput: document.getElementById('file-input'),
  dropZone: document.getElementById('drop-zone'),
  uploadStatus: document.getElementById('upload-status'),
  reviewSummary: document.getElementById('review-summary'),
  reviewForm: document.getElementById('review-form'),
  benefitItemsTable: document.getElementById('benefit-items-table'),
  optionsTable: document.getElementById('options-table'),
  revalidateBtn: document.getElementById('revalidate-btn'),
  ackCheckbox: document.getElementById('ack-checkbox'),
  quotationNumberInput: document.getElementById('quotation-number-input'),
  validUntilInput: document.getElementById('valid-until-input'),
  generateBtn: document.getElementById('generate-btn'),
  startOverBtn: document.getElementById('start-over-btn'),
  downloadSection: document.getElementById('download-section'),
  downloadBtn: document.getElementById('download-btn'),
  previewFrame: document.getElementById('preview-frame'),
};

function showStage(stage) {
  state.stage = stage;
  el.uploadStage.hidden = stage !== 'upload';
  el.reviewStage.hidden = stage !== 'review';
}

// --- Upload -> parse -------------------------------------------------------

async function handleFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    el.uploadStatus.textContent = 'Please choose a PDF file.';
    return;
  }
  state.fileName = file.name;
  el.uploadStatus.textContent = `Reading ${file.name}...`;
  try {
    const buffer = await file.arrayBuffer();
    el.uploadStatus.textContent = 'Extracting text from PDF (this never leaves your browser)...';
    const pages = await extractPagesFromPdf(new Uint8Array(buffer));
    el.uploadStatus.textContent = 'Parsing quotation data...';
    const result = parseQuotation(pages, { sourceFileName: file.name, validityDays: 14 });
    state.data = result.data;
    state.warnings = result.warnings;
    state.errors = result.errors;
    state.reviewAcknowledged = false;
    renderReview();
    showStage('review');
  } catch (err) {
    el.uploadStatus.textContent = `Could not read this PDF: ${err.message}. Try the agent review screen won't be shown - please check the file and try again.`;
    console.error(err);
  }
}

el.fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
el.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.dropZone.classList.add('drag-over');
});
el.dropZone.addEventListener('dragleave', () => el.dropZone.classList.remove('drag-over'));
el.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropZone.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});

// --- Review screen ---------------------------------------------------------

function renderReview() {
  renderSummary();
  renderForm();
  renderBenefitItemsTable();
  renderOptionsTable();
  updateGateState();
}

function renderSummary() {
  const { errors, warnings } = state;
  const parts = [];
  if (errors.length) {
    parts.push(`<div class="banner banner-error"><b>${errors.length} required field(s) still need attention.</b> The client quotation cannot be generated until these are fixed below.</div>`);
  } else {
    parts.push(`<div class="banner banner-ok">All required fields are present.</div>`);
  }
  if (warnings.length) {
    parts.push(`<div class="banner banner-warn"><b>${warnings.length} warning(s).</b> Review the flagged fields below - none of this is shown to the client, but you should verify it against the source PDF.</div>`);
  }
  el.reviewSummary.innerHTML = parts.join('');
}

function fieldRowHtml(field) {
  const value = getPath(state.data, field.path);
  const fieldWarnings = warningsForPath(state.warnings, field.path);
  const fieldErrors = errorsForPath(state.errors, field.path);
  const hasError = fieldErrors.length > 0;
  const displayValue = value == null ? '' : value;
  const inputType = field.type === 'number' ? 'number' : 'text';
  const notesHtml = [
    ...fieldErrors.map((e) => `<div class="field-note field-note-error">${escapeHtml(e.message)}</div>`),
    ...fieldWarnings.map((w) => `<div class="field-note field-note-warn">${escapeHtml(w.message)}</div>`),
  ].join('');
  return `
    <label class="field-row ${hasError ? 'field-row-error' : ''}">
      <span class="field-label">${escapeHtml(field.label)}</span>
      <input type="${inputType}" data-path="${field.path}" value="${escapeHtml(String(displayValue))}" class="field-input">
      ${notesHtml}
    </label>`;
}

function renderForm() {
  const sections = [...new Set(EDITABLE_FIELDS.map((f) => f.section))];
  const html = sections
    .map((section) => {
      const fields = EDITABLE_FIELDS.filter((f) => f.section === section);
      return `<fieldset><legend>${escapeHtml(section)}</legend>${fields.map(fieldRowHtml).join('')}</fieldset>`;
    })
    .join('');
  el.reviewForm.innerHTML = html;
  el.reviewForm.querySelectorAll('.field-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const path = e.target.dataset.path;
      const field = EDITABLE_FIELDS.find((f) => f.path === path);
      const raw = e.target.value;
      const value = field.type === 'number' ? (raw === '' ? null : Number(raw)) : raw === '' ? null : raw;
      setPath(state.data, path, value);
      state.reviewAcknowledged = false;
      updateGateState();
    });
  });
}

function renderBenefitItemsTable() {
  const items = (state.data.benefits && state.data.benefits.benefitItems) || [];
  const rows = items
    .map((item, i) => {
      const warn = state.warnings.find((w) => w.field === `benefits.benefitItems.${item.label}`);
      return `
      <tr class="${item.value == null ? 'row-flagged' : ''}">
        <td>${escapeHtml(item.label)}</td>
        <td><input type="text" data-benefit-index="${i}" value="${escapeHtml(item.value || '')}" class="field-input"></td>
      </tr>
      ${warn ? `<tr class="note-row"><td colspan="2" class="field-note field-note-warn">${escapeHtml(warn.message)}</td></tr>` : ''}`;
    })
    .join('');
  el.benefitItemsTable.innerHTML = `<table><thead><tr><th>Benefit</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
  el.benefitItemsTable.querySelectorAll('[data-benefit-index]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const idx = Number(e.target.dataset.benefitIndex);
      state.data.benefits.benefitItems[idx].value = e.target.value || null;
      state.reviewAcknowledged = false;
      updateGateState();
    });
  });
}

const OPTION_COLUMN_FIELDS = [
  ['productName', 'Product name'],
  ['annualContribution', 'Annual contribution (RM)'],
  ['coPaymentOption', 'Co-payment option'],
  ['roomAndBoard', 'Room & board'],
  ['annualLimitOption', 'Annual limit'],
  ['lifetimeLimitOption', 'Lifetime limit'],
  ['facilityType', 'Facility type'],
];

function renderOptionsTable() {
  const columns = (state.data.options && state.data.options.columns) || [];
  const head = `<tr><th></th>${columns.map((c) => `<th>${escapeHtml(c.optionLabel || '')}</th>`).join('')}</tr>`;
  const rows = OPTION_COLUMN_FIELDS.map(
    ([key, label]) => `
    <tr>
      <th>${escapeHtml(label)}</th>
      ${columns
        .map(
          (c, i) =>
            `<td><input type="text" data-option-index="${i}" data-option-key="${key}" value="${escapeHtml(c[key] == null ? '' : String(c[key]))}" class="field-input"></td>`
        )
        .join('')}
    </tr>`
  ).join('');
  el.optionsTable.innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  el.optionsTable.querySelectorAll('[data-option-index]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const idx = Number(e.target.dataset.optionIndex);
      const key = e.target.dataset.optionKey;
      const raw = e.target.value;
      state.data.options.columns[idx][key] = key === 'annualContribution' ? (raw === '' ? null : Number(raw)) : raw || null;
      state.reviewAcknowledged = false;
      updateGateState();
    });
  });
}

// --- Re-validate, confirm, generate -----------------------------------------

function revalidate() {
  const { warnings, errors } = validateQuotation(state.data);
  state.warnings = warnings;
  state.errors = errors;
  state.reviewAcknowledged = false;
  renderReview();
}

el.revalidateBtn.addEventListener('click', revalidate);

function updateGateState() {
  const canAcknowledge = state.errors.length === 0;
  el.ackCheckbox.disabled = !canAcknowledge;
  if (!canAcknowledge) {
    el.ackCheckbox.checked = false;
    state.reviewAcknowledged = false;
  }
  el.generateBtn.disabled = !(canAcknowledge && el.ackCheckbox.checked);
}

el.ackCheckbox.addEventListener('change', (e) => {
  state.reviewAcknowledged = e.target.checked;
  updateGateState();
});

el.generateBtn.addEventListener('click', () => {
  const parseResult = { data: state.data, warnings: state.warnings, errors: state.errors };
  const agentReview = {
    acknowledged: state.reviewAcknowledged,
    quotationNumber: el.quotationNumberInput.value.trim() || null,
    validUntilIso: el.validUntilInput.value || null,
  };
  const html = renderClientQuotationHtml(parseResult, agentReview);
  el.previewFrame.srcdoc = html;
  el.downloadSection.hidden = false;
  el.downloadBtn.onclick = () => downloadHtml(html);
});

function downloadHtml(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (state.data.client.fullName || 'quotation').replace(/[^a-z0-9]+/gi, '_');
  a.href = url;
  a.download = `${safeName}_quotation.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

el.startOverBtn.addEventListener('click', () => {
  state.stage = 'upload';
  state.data = null;
  state.warnings = [];
  state.errors = [];
  state.reviewAcknowledged = false;
  el.fileInput.value = '';
  el.downloadSection.hidden = true;
  el.uploadStatus.textContent = '';
  showStage('upload');
});

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
