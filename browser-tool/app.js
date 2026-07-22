/**
 * app.js
 *
 * Browser tool application logic - the production quotation generator.
 * This is the only file in the project that wires the frozen parser and
 * the Phase 2 renderer together behind a UI - it contains no parsing
 * logic of its own (that's pdfTextSource.browser.js + parser/*) and no
 * rendering-template logic of its own (that's renderer/renderQuotation.js
 * and renderer/renderComparison.js). Its job is state management:
 * upload (1-3 PDFs) -> parse each -> agent review/edit (tabbed per
 * quotation) -> confirm -> generate client document(s) + comparison ->
 * download/print.
 *
 * Privacy: everything below runs entirely client-side. Each PDF is read
 * via FileReader, parsed via pdf.js (vendored, not a CDN), and never
 * leaves the browser - there is no fetch/XHR/WebSocket anywhere in this
 * file or anything it calls (the one exception, deliberately isolated:
 * destinations/AirtableDestination.js, which only ever runs inside the
 * generated CLIENT document, not this agent tool).
 */

'use strict';

const { extractPagesFromPdf } = require('./pdfTextSource.browser.js');
const { parseQuotation, normalizeAndValidate } = require('../parser/index.js');
const { renderAgentReviewHtml, renderClientQuotationHtml } = require('../renderer/renderQuotation.js');
const { renderComparisonHtml } = require('../renderer/renderComparison.js');
const { primaryValue } = require('../renderer/formatters.js');
const { RENDERER_VERSION } = require('../renderer/renderNarrativeQuotation.js');
const { buildPrefillData } = require('./application/buildPrefillData.js');
const { composeClientDocument } = require('./application/composeClientDocument.js');
const { publishQuotation } = require('./publishQuotation.js');

const MAX_QUOTATIONS = 3;
// A real PruBSN Product Illustration is a few MB at most (the sample used
// throughout development is ~1.7MB). This is a generous ceiling meant only
// to stop an accidentally-selected huge/wrong file (a misclick can easily
// pick a multi-hundred-MB video or disk image) from being read entirely
// into memory and handed to pdf.js, which can hang or crash the tab -
// there was previously no size check at all on this upload step (only the
// later, separate 5MB document-upload step in the client-facing form had
// one).
const MAX_PDF_BYTES = 50 * 1024 * 1024;

// --- Known merged-cell benefit values -----------------------------------
// The frozen parser deliberately leaves a benefit item's value as `null`
// (plus a warning) rather than guess which neighbouring row's value it
// shares a merged PDF table cell with - see extractBenefits.js. That's
// the right call for a general-purpose parser, but for THIS product's
// Table of Benefits the merge groups are fixed and have been visually
// verified against the actual rendered table (real cell borders, not
// just text order) in the source PDF used throughout this project:
//   - "Surgical Procedure and Treatment" shares a cell with "Intensive
//     Care Unit (ICU) / Cardiac Care Unit (CCU)" and "In Hospital and
//     Related Services", all reading "As charged".
//   - "Post-Hospitalisation Treatment" shares a cell with
//     "Pre-Hospitalisation Treatment", reading "As charged".
//   - "Outpatient Kidney Dialysis Treatment" shares a cell with
//     "Outpatient Cancer Treatment", reading "RM1,000,000 per lifetime" -
//     NOT "As charged", despite how similar the two nearby "As charged"
//     rows might look at a glance.
// This is a display-layer PRE-FILL (still shown with its warning, still
// editable, still requires the agent's review) - not a change to what
// the parser extracted or how it validates. If a future PDF version
// changes this table's layout, the pre-fill would need re-verifying the
// same way - it is not derived from text position, it is a hardcoded,
// visually-confirmed fact about this specific document version.
const KNOWN_MERGED_BENEFIT_VALUES = {
  'Surgical Procedure and Treatment': 'As charged',
  'Post-Hospitalisation Treatment': 'As charged',
  'Outpatient Kidney Dialysis Treatment': 'RM1,000,000 per lifetime',
};

function applyKnownMergedBenefitValues(data) {
  const items = data && data.benefits && data.benefits.benefitItems;
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const known = KNOWN_MERGED_BENEFIT_VALUES[item.label];
    if (known && !primaryValue(item.value)) {
      item.value = known;
      item.prefilledFromKnownMergedCell = true;
    }
  }
}

// --- Editable field registry -------------------------------------------
// One entry per scalar field an agent can hand-correct. `path` is a
// dot-path into a quotation's `data`; `label` is what's shown in the
// review form. Array fields (benefitItems) get their own table renderer
// below instead of appearing here.
//
// Product-aware (see editableFieldsFor() below): Metadata/Client/Agent
// paths are identical for both products (extractMetadata.js/
// extractAgent.js are shared, unchanged extractors), but Plan/
// Contributions/Benefits are NOT - AnugerahMax's raw extractor output
// has data.plan/data.contributions/data.benefits; Asas360's has
// data.medicalRider/data.basicPlan instead (see extractors/asas360.js).
// Edits must target these RAW, pre-normalization fields, not
// data.medical/data.protection directly - normalizeAndValidate() is
// re-run after every edit and recomputes data.medical/data.protection
// FROM these raw fields, so an edit to the normalized shape alone would
// be silently discarded on the next re-render.
//
// This exact bug (a single static AnugerahMax-only field list shown
// unconditionally for every product) was found via a real, uploaded
// Asas360 PDF: 18 of 28 review-form fields rendered as silently blank
// inputs, mislabelled "Basic plan name" / "Medic TotalCare contribution"
// / "Annual limit" etc. for a quotation that has none of those concepts.
const COMMON_EDITABLE_FIELDS = [
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
];

const ANUGERAHMAX_EDITABLE_FIELDS = [
  ...COMMON_EDITABLE_FIELDS,
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
];

const ASAS360_EDITABLE_FIELDS = [
  ...COMMON_EDITABLE_FIELDS,
  { section: 'Plan', path: 'basicPlan.basicPlanName', label: 'Basic plan name' },
  { section: 'Plan', path: 'basicPlan.basicPlanTerm', label: 'Basic plan term (years)', type: 'number' },
  { section: 'Plan', path: 'basicPlan.basicSumCovered', label: 'Basic sum covered (RM)', type: 'number' },
  { section: 'Plan', path: 'medicalRider.riderName', label: 'Medical rider name' },
  { section: 'Plan', path: 'medicalRider.planTier', label: 'Medical plan tier' },
  { section: 'Plan', path: 'medicalRider.coPaymentOption', label: 'Co-payment option' },
  { section: 'Plan', path: 'medicalRider.coverageToAge', label: 'Coverage to age', type: 'number' },
  { section: 'Contributions', path: 'monthlyTotalAmountPayable', label: 'Monthly Total Amount Payable (RM)', type: 'number' },
  { section: 'Contributions', path: 'totalAnnualContribution', label: 'Total Annual Contribution (RM)', type: 'number' },
  { section: 'Benefits', path: 'medicalRider.smartValuePoint', label: 'Smart Value Point (RM)', type: 'number' },
  { section: 'Benefits', path: 'medicalRider.lifetimeLimit', label: 'Lifetime limit' },
  { section: 'Benefits', path: 'basicPlan.deathBenefit.amount', label: 'Death Benefit (RM)', type: 'number' },
  { section: 'Benefits', path: 'basicPlan.tpdBenefit.amount', label: 'TPD Benefit (RM)', type: 'number' },
];

/** Which registry applies to this specific quotation - keyed the same way normalizeAndValidate() itself decides product, never metadata.productName string-matching. */
function editableFieldsFor(q) {
  const isAsas360 = Boolean(q && q.data && q.data.medicalRider);
  console.log('[DIAGNOSTIC 4] Review schema selected for %s: %s', (q && q.fileName) || '(unknown)', isAsas360 ? 'ASAS360_EDITABLE_FIELDS' : 'ANUGERAHMAX_EDITABLE_FIELDS');
  return isAsas360 ? ASAS360_EDITABLE_FIELDS : ANUGERAHMAX_EDITABLE_FIELDS;
}

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
  return (warnings || []).filter((w) => w.field === path || w.field.startsWith(path + '.'));
}

function errorsForPath(errors, path) {
  return (errors || []).filter((e) => e.field === path || e.field.startsWith(path + '.'));
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Application state ---------------------------------------------------

let quotationIdCounter = 0;

const state = {
  stage: 'upload', // upload | review | output
  quotations: [], // { id, fileName, status: 'parsing'|'ready'|'error', errorMessage, data, warnings, errors }
  activeReviewIndex: 0,
  activeOutputIndex: 0,
  quotationNumber: '',
  validUntilIso: '',
  generatedDocs: [], // [{ fileName, html }] one per quotation, filled in on Generate
  comparisonHtml: null,
};

// --- DOM ------------------------------------------------------------------

const el = {
  stages: {
    upload: document.getElementById('stage-upload'),
    review: document.getElementById('stage-review'),
    output: document.getElementById('stage-output'),
  },
  stepChips: Array.from(document.querySelectorAll('.step-chip')),
  fileInput: document.getElementById('file-input'),
  dropZone: document.getElementById('drop-zone'),
  fileList: document.getElementById('file-list'),
  uploadNotice: document.getElementById('upload-notice'),
  continueBtn: document.getElementById('continue-to-review-btn'),

  reviewTabs: document.getElementById('review-tabs'),
  reviewPanels: document.getElementById('review-panels'),
  revalidateBtn: document.getElementById('revalidate-btn'),
  ackCheckbox: document.getElementById('ack-checkbox'),
  quotationNumberInput: document.getElementById('quotation-number-input'),
  validUntilInput: document.getElementById('valid-until-input'),
  generateBtn: document.getElementById('generate-btn'),
  backToUploadBtn: document.getElementById('back-to-upload-btn'),
  startOverBtn: document.getElementById('start-over-btn'),

  outputBanner: document.getElementById('output-banner'),
  publishStatus: document.getElementById('publish-status'),
  publishLinkRow: document.getElementById('publish-link-row'),
  publicLinkInput: document.getElementById('public-link-input'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  openClientViewBtn: document.getElementById('open-client-view-btn'),
  comparisonBlock: document.getElementById('comparison-block'),
  comparisonFrame: document.getElementById('comparison-frame'),
  printComparisonBtn: document.getElementById('print-comparison-btn'),
  outputTabs: document.getElementById('output-tabs'),
  previewFrame: document.getElementById('preview-frame'),
  previewViewQuotationBtn: document.getElementById('preview-view-quotation-btn'),
  previewViewFormBtn: document.getElementById('preview-view-form-btn'),
  downloadBtn: document.getElementById('download-btn'),
  printBtn: document.getElementById('print-btn'),
  outputBackBtn: document.getElementById('output-back-btn'),
  outputStartOverBtn: document.getElementById('output-start-over-btn'),
};

function showStage(stage) {
  state.stage = stage;
  Object.entries(el.stages).forEach(([name, node]) => node.classList.toggle('active', name === stage));
  const order = ['upload', 'review', 'output'];
  const activeIdx = order.indexOf(stage);
  el.stepChips.forEach((chip) => {
    const idx = order.indexOf(chip.dataset.step);
    chip.classList.toggle('active', idx === activeIdx);
    chip.classList.toggle('done', idx < activeIdx);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Upload -> parse (1-3 files) -------------------------------------------

function renderFileList() {
  el.fileList.innerHTML = state.quotations.map((q, i) => {
    const icon = q.status === 'parsing' ? '<span class="spinner" aria-hidden="true"></span>'
      : q.status === 'ready' ? '&#10003;'
      : '&#10007;';
    const statusText = q.status === 'parsing' ? 'Reading and parsing&hellip;'
      : q.status === 'ready' ? (q.errors && q.errors.length ? `${q.errors.length} required field(s) need attention` : 'Ready for review')
      : q.errorMessage || 'Could not read this file.';
    return `
      <div class="file-chip ${q.status}">
        <div class="fi">${icon}</div>
        <div class="meta">
          <div class="fname">${escapeHtml(q.fileName)}</div>
          <div class="fstatus">${escapeHtml(statusText)}</div>
        </div>
        <button type="button" class="remove-btn" data-remove-index="${i}" aria-label="Remove ${escapeHtml(q.fileName)}">&times;</button>
      </div>`;
  }).join('');

  el.fileList.querySelectorAll('[data-remove-index]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.currentTarget.dataset.removeIndex);
      state.quotations.splice(idx, 1);
      renderFileList();
      updateContinueButton();
    });
  });
}

function updateContinueButton() {
  const hasParsing = state.quotations.some((q) => q.status === 'parsing');
  const hasReady = state.quotations.some((q) => q.status === 'ready');
  el.continueBtn.hidden = state.quotations.length === 0;
  el.continueBtn.disabled = hasParsing || !hasReady;
  el.continueBtn.textContent = hasParsing ? 'Parsing…' : 'Continue to Review →';
}

function showUploadNotice(message) {
  el.uploadNotice.textContent = message;
  el.uploadNotice.hidden = false;
}

function clearUploadNotice() {
  el.uploadNotice.hidden = true;
  el.uploadNotice.textContent = '';
}

/** Same name + same size is treated as the same file re-selected by accident (drag-drop and the file picker both make this easy to do without noticing). */
function isDuplicateOfExisting(file) {
  return state.quotations.some((q) => q.fileName === file.name && q.fileSize === file.size);
}

async function parseOneFile(entry, file) {
  try {
    const buffer = await file.arrayBuffer();
    const pages = await extractPagesFromPdf(new Uint8Array(buffer));
    const result = parseQuotation(pages, { sourceFileName: file.name, validityDays: 14 });
    console.log('[DIAGNOSTIC app.js] parseOneFile(%s): metadata.productName=%s, has data.medical=%s, has data.protection=%s', file.name, result.data && result.data.metadata && result.data.metadata.productName, Boolean(result.data && result.data.medical), Boolean(result.data && result.data.protection));
    applyKnownMergedBenefitValues(result.data);
    entry.status = 'ready';
    entry.data = result.data;
    entry.warnings = result.warnings;
    entry.errors = result.errors;
  } catch (err) {
    entry.status = 'error';
    const reason = (err && err.message ? err.message : 'unknown error').replace(/\.+$/, '');
    entry.errorMessage = `Could not read this PDF: ${reason}.`;
    console.error(err);
  }
  renderFileList();
  updateContinueButton();
}

function handleFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;
  clearUploadNotice();

  // Duplicates are filtered out before the slot-count check below, so a
  // re-dropped file doesn't eat into the 3-quotation limit.
  const duplicateNames = [];
  const deduped = incoming.filter((file) => {
    if (isDuplicateOfExisting(file)) {
      duplicateNames.push(file.name);
      return false;
    }
    return true;
  });

  const remainingSlots = MAX_QUOTATIONS - state.quotations.length;
  const accepted = deduped.slice(0, Math.max(0, remainingSlots));
  const overflowCount = deduped.length - accepted.length;

  for (const file of accepted) {
    const entry = {
      id: `q${quotationIdCounter++}`,
      fileName: file.name,
      fileSize: file.size,
      status: 'parsing',
      errorMessage: null,
      data: null,
      warnings: [],
      errors: [],
    };
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      entry.status = 'error';
      entry.errorMessage = 'Not a PDF file.';
      state.quotations.push(entry);
      continue;
    }
    if (file.size > MAX_PDF_BYTES) {
      entry.status = 'error';
      entry.errorMessage = `File is too large (${Math.round(file.size / 1024 / 1024)}MB) - please check this is the right file.`;
      state.quotations.push(entry);
      continue;
    }
    state.quotations.push(entry);
    parseOneFile(entry, file);
  }

  const notices = [];
  if (duplicateNames.length) {
    notices.push(`Already added, skipped: ${duplicateNames.join(', ')}.`);
  }
  if (overflowCount > 0) {
    notices.push(`Only ${MAX_QUOTATIONS} quotations can be compared at once - ${overflowCount} file${overflowCount > 1 ? 's were' : ' was'} not added. Remove one above to add another.`);
  }
  if (notices.length) showUploadNotice(notices.join(' '));

  renderFileList();
  updateContinueButton();
}

el.fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  el.fileInput.value = '';
});
el.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.dropZone.classList.add('drag-over');
});
el.dropZone.addEventListener('dragleave', () => el.dropZone.classList.remove('drag-over'));
el.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

el.continueBtn.addEventListener('click', () => {
  state.quotations = state.quotations.filter((q) => q.status === 'ready');
  if (!state.quotations.length) return;
  state.activeReviewIndex = 0;
  renderReviewStage();
  showStage('review');
});

// --- Review stage (tabbed, one tab per quotation) ---------------------------

function quotationLabel(q, index) {
  const name = q.data && q.data.client && q.data.client.fullName;
  return name || q.fileName || `Quotation ${index + 1}`;
}

function fieldRowHtml(q, qIndex, field) {
  const value = getPath(q.data, field.path);
  const fieldWarnings = warningsForPath(q.warnings, field.path);
  const fieldErrors = errorsForPath(q.errors, field.path);
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
      <input type="${inputType}" data-q-index="${qIndex}" data-path="${field.path}" value="${escapeHtml(String(displayValue))}" class="field-input">
      ${notesHtml}
    </label>`;
}

function benefitItemsTableHtml(q, qIndex) {
  // Sourced from data.medical (product-agnostic - populated for both
  // AnugerahMax and Asas360), not data.benefits directly - which only
  // ever exists for AnugerahMax and left this table empty for Asas360.
  const items = (q.data.medical && q.data.medical.benefitItems) || [];
  const rows = items.map((item, i) => {
    const warn = (q.warnings || []).find((w) => w.field === `benefits.benefitItems.${item.label}` || w.field === `medicalRider.benefitItems.${item.label}`);
    const note = item.prefilledFromKnownMergedCell
      ? 'Pre-filled: this row shares a merged cell with an adjacent benefit in the source PDF. Value verified against the source document - please confirm before sending.'
      : warn && warn.message;
    return `
      <tr class="${item.value == null ? 'row-flagged' : ''}">
        <td>${escapeHtml(item.label)}</td>
        <td><input type="text" data-q-index="${qIndex}" data-benefit-index="${i}" value="${escapeHtml(item.value || '')}" class="field-input"></td>
      </tr>
      ${note ? `<tr class="note-row"><td colspan="2" class="field-note field-note-warn">${escapeHtml(note)}</td></tr>` : ''}`;
  }).join('');
  return `<div class="table-scroll"><table><thead><tr><th>Benefit</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function reviewPanelHtml(q, qIndex) {
  const { errors, warnings } = q;
  const banners = [];
  if (errors.length) {
    banners.push(`<div class="banner banner-error"><b>${errors.length} required field(s) still need attention.</b> The client quotation cannot be generated until these are fixed.</div>`);
  } else {
    banners.push(`<div class="banner banner-ok">All required fields are present.</div>`);
  }
  if (warnings.length) {
    banners.push(`<div class="banner banner-warn"><b>${warnings.length} warning(s).</b> Review the flagged fields below - none of this is shown to the client, but you should verify it against the source PDF.</div>`);
  }

  const editableFields = editableFieldsFor(q);
  const sections = [...new Set(editableFields.map((f) => f.section))];
  const formHtml = sections.map((section) => {
    const fields = editableFields.filter((f) => f.section === section);
    return `<fieldset><legend>${escapeHtml(section)}</legend><div class="fields-grid">${fields.map((f) => fieldRowHtml(q, qIndex, f)).join('')}</div></fieldset>`;
  }).join('');

  return `
    <div class="tab-panel ${qIndex === state.activeReviewIndex ? 'active' : ''}" data-panel-index="${qIndex}">
      ${banners.join('')}
      <h2 class="section-title">Extracted fields</h2>
      ${formHtml}
      <h2 class="section-title">Benefits table</h2>
      ${benefitItemsTableHtml(q, qIndex)}
    </div>`;
}

function renderReviewTabs() {
  el.reviewTabs.innerHTML = state.quotations.map((q, i) => {
    const cls = q.errors.length ? 'tab-error' : 'tab-ok';
    return `<button type="button" class="tab-btn ${cls} ${i === state.activeReviewIndex ? 'active' : ''}" data-tab-index="${i}">
      <span class="tab-dot"></span>${escapeHtml(quotationLabel(q, i))}
    </button>`;
  }).join('');
  el.reviewTabs.hidden = state.quotations.length <= 1;
  el.reviewTabs.querySelectorAll('[data-tab-index]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      state.activeReviewIndex = Number(e.currentTarget.dataset.tabIndex);
      renderReviewTabs();
      el.reviewPanels.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('active', Number(panel.dataset.panelIndex) === state.activeReviewIndex);
      });
    });
  });
}

function renderReviewStage() {
  // [DIAGNOSTIC 5] Renderer selected for the Review stage - reviewPanelHtml()
  // (this file's own in-page editable form), NOT renderAgentReviewHtml()
  // (renderer/renderQuotation.js) - that function is imported above but
  // has no call site anywhere in this file. Confirmed via full-file grep.
  console.log('[DIAGNOSTIC 5] Review stage renderer: reviewPanelHtml() in browser-tool/app.js (renderAgentReviewHtml from renderer/renderQuotation.js is imported but never called)');
  renderReviewTabs();
  el.reviewPanels.innerHTML = state.quotations.map((q, i) => reviewPanelHtml(q, i)).join('');
  updateGateState();
}

// Event delegation: one listener on the panels container handles every
// quotation's inputs, keyed by `data-q-index` - avoids re-attaching
// per-input listeners on every re-render.
el.reviewPanels.addEventListener('input', (e) => {
  const target = e.target;
  const qIndex = Number(target.dataset.qIndex);
  if (Number.isNaN(qIndex) || !state.quotations[qIndex]) return;
  const q = state.quotations[qIndex];

  if (target.dataset.path) {
    const path = target.dataset.path;
    const field = editableFieldsFor(q).find((f) => f.path === path);
    const raw = target.value;
    const value = field && field.type === 'number' ? (raw === '' ? null : Number(raw)) : raw === '' ? null : raw;
    setPath(q.data, path, value);
  } else if (target.dataset.benefitIndex != null && target.dataset.benefitIndex !== '') {
    const idx = Number(target.dataset.benefitIndex);
    q.data.medical.benefitItems[idx].value = target.value || null;
    q.data.medical.benefitItems[idx].prefilledFromKnownMergedCell = false;
  }
  // data.medical is DERIVED from the raw extracted fields just edited
  // above (data.plan/data.benefits for AnugerahMax, data.medicalRider for
  // Asas360) - re-derive it now so the client document (generated
  // straight from q.data, with no re-parse) reflects this edit, not the
  // pre-edit value. Deliberately does not overwrite q.warnings/q.errors
  // here - those only refresh on an explicit "Revalidate" click, same as
  // before this fix.
  normalizeAndValidate(q.data);
  updateGateState();
});

function revalidateAll() {
  for (const q of state.quotations) {
    // Re-derives data.medical from whatever the agent just hand-edited in
    // data.plan/data.benefits (AnugerahMax) or data.medicalRider
    // (Asas360) - the renderer reads only data.medical, so skipping this
    // would leave it showing stale, pre-edit values - and runs the same
    // product-aware validation parseQuotation() itself uses (never
    // AnugerahMax's own validateQuotation() against Asas360 data).
    const { warnings, errors } = normalizeAndValidate(q.data);
    q.warnings = warnings;
    q.errors = errors;
  }
  renderReviewStage();
}

el.revalidateBtn.addEventListener('click', revalidateAll);

function updateGateState() {
  const canAcknowledge = state.quotations.every((q) => q.errors.length === 0);
  el.ackCheckbox.disabled = !canAcknowledge;
  if (!canAcknowledge) el.ackCheckbox.checked = false;
  el.generateBtn.disabled = !(canAcknowledge && el.ackCheckbox.checked);
  // Error/OK dot on each tab reflects live edits without a full re-render.
  el.reviewTabs.querySelectorAll('[data-tab-index]').forEach((btn) => {
    const i = Number(btn.dataset.tabIndex);
    const hasErrors = state.quotations[i] && state.quotations[i].errors.length > 0;
    btn.classList.toggle('tab-error', hasErrors);
    btn.classList.toggle('tab-ok', !hasErrors);
  });
}

el.ackCheckbox.addEventListener('change', updateGateState);

el.backToUploadBtn.addEventListener('click', () => showStage('upload'));

el.startOverBtn.addEventListener('click', resetAll);

// --- Generate: client quotation(s) + comparison -----------------------------

/**
 * Publishes every generated doc (in parallel - independent requests, one
 * failure shouldn't block the others) and stores each result on its own
 * doc object. Runs AFTER the output stage is already shown with
 * publish.status = 'pending' for every doc, so the agent sees the
 * quotation immediately and a live "publishing…" indicator, rather than
 * waiting on a blocking spinner before anything appears at all.
 */
async function publishAllGeneratedDocs() {
  await Promise.all(
    state.generatedDocs.map(async (doc) => {
      const result = await publishQuotation(doc.data, doc.html, RENDERER_VERSION);
      doc.publish = result;
      // Only re-render if this doc is still the one on screen - avoids a
      // slow, since-abandoned publish call clobbering a newer render
      // (e.g. the agent already clicked "Start a new quotation").
      if (state.generatedDocs.includes(doc) && state.stage === 'output') {
        renderOutputStage();
      }
    })
  );
}

el.generateBtn.addEventListener('click', () => {
  const agentReview = {
    acknowledged: true,
    quotationNumber: el.quotationNumberInput.value.trim() || null,
    validUntilIso: el.validUntilInput.value || null,
  };

  const allData = state.quotations.map((q) => q.data);
  const prefillData = buildPrefillData(allData, agentReview);

  state.generatedDocs = state.quotations.map((q) => {
    const quotationHtml = renderClientQuotationHtml({ data: q.data, warnings: q.warnings, errors: q.errors }, agentReview);
    const html = composeClientDocument(quotationHtml, prefillData);
    const safeName = (q.data.client.fullName || 'quotation').replace(/[^a-z0-9]+/gi, '_');
    return { fileName: `${safeName}_quotation.html`, html, label: quotationLabel(q, 0), data: q.data, publish: { status: 'pending' } };
  });

  state.comparisonHtml = state.quotations.length > 1
    ? renderComparisonHtml(
        state.quotations.map((q) => ({ data: q.data, warnings: q.warnings, errors: [] })),
        state.quotations.map(() => ({ acknowledged: true }))
      )
    : null;

  state.activeOutputIndex = 0;
  renderOutputStage();
  showStage('output');
  publishAllGeneratedDocs();
});

function renderPublishBlock(doc) {
  if (!doc) {
    el.publishStatus.innerHTML = '';
    el.publishLinkRow.hidden = true;
    return;
  }
  const publish = doc.publish || { status: 'pending' };

  if (publish.status === 'pending') {
    el.publishStatus.innerHTML = `<div class="banner banner-info"><span class="spinner" aria-hidden="true"></span> Publishing quotation…</div>`;
    el.publishLinkRow.hidden = true;
  } else if (publish.status === 'failed') {
    const errorText = String(publish.error || 'unknown error').trim().replace(/\.+$/, '');
    el.publishStatus.innerHTML = `<div class="banner banner-error">Could not publish this quotation: ${escapeHtml(errorText)}. <button type="button" class="btn-outline" id="publish-retry-btn">Retry</button></div>`;
    el.publishLinkRow.hidden = true;
    const retryBtn = document.getElementById('publish-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        doc.publish = { status: 'pending' };
        renderOutputStage();
        doc.publish = await publishQuotation(doc.data, doc.html, RENDERER_VERSION);
        if (state.generatedDocs.includes(doc) && state.stage === 'output') renderOutputStage();
      });
    }
  } else {
    el.publishStatus.innerHTML = `<div class="banner banner-ok">Quotation generated successfully.</div>`;
    el.publishLinkRow.hidden = false;
    el.publicLinkInput.value = publish.url;
  }
}

el.copyLinkBtn.addEventListener('click', async () => {
  const doc = state.generatedDocs[state.activeOutputIndex];
  if (!doc || !doc.publish || doc.publish.status !== 'success') return;
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(doc.publish.url);
    el.copyLinkBtn.textContent = '✓ Client link copied';
  } catch (e) {
    el.copyLinkBtn.textContent = 'Could not copy - select the link above manually';
    el.publicLinkInput.select();
  }
  setTimeout(() => { el.copyLinkBtn.textContent = 'Copy Client Link'; }, 2500);
});

el.openClientViewBtn.addEventListener('click', () => {
  const doc = state.generatedDocs[state.activeOutputIndex];
  if (!doc || !doc.publish || doc.publish.status !== 'success') return;
  window.open(doc.publish.url, '_blank');
});

function renderOutputStage() {
  const multi = state.quotations.length > 1;
  el.outputBanner.innerHTML = multi
    ? `<div class="banner banner-ok">${state.quotations.length} quotations generated. A comparison is shown automatically below.</div>`
    : '';

  el.comparisonBlock.hidden = !multi;
  if (multi) {
    el.comparisonFrame.srcdoc = state.comparisonHtml;
  }

  el.outputTabs.hidden = !multi;
  el.outputTabs.innerHTML = state.generatedDocs.map((doc, i) => `
    <button type="button" class="tab-btn ${i === state.activeOutputIndex ? 'active' : ''}" data-output-tab-index="${i}">${escapeHtml(doc.label)}</button>
  `).join('');
  el.outputTabs.querySelectorAll('[data-output-tab-index]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      state.activeOutputIndex = Number(e.currentTarget.dataset.outputTabIndex);
      renderOutputStage();
    });
  });

  const activeDoc = state.generatedDocs[state.activeOutputIndex];
  renderPublishBlock(activeDoc);
  el.previewFrame.srcdoc = activeDoc ? activeDoc.html : '';
  // Every switch back to "Quotation" (new doc, tab switch) shows the top of
  // the document - the client form only appears once "Continue Application"
  // is triggered inside the iframe, via showClientForm() below.
  el.previewViewQuotationBtn.classList.add('active');
  el.previewViewFormBtn.classList.remove('active');
}

/** Reaches into the (unsandboxed, same-file) preview iframe and opens its embedded "Continue Application" flow, so the agent can preview the client form as its own explicit step rather than scrolling/clicking inside the quotation preview themselves. */
function showClientFormInPreview() {
  const doc = el.previewFrame.contentDocument;
  if (!doc) return;
  const continueBtn = doc.getElementById('paf-continue-btn');
  const root = doc.getElementById('paf-app-root');
  if (continueBtn && root && root.hidden) continueBtn.click();
  if (root) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.previewViewFormBtn.classList.add('active');
  el.previewViewQuotationBtn.classList.remove('active');
}

function showQuotationInPreview() {
  const doc = el.previewFrame.contentDocument;
  if (doc && doc.documentElement) doc.documentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.previewViewQuotationBtn.classList.add('active');
  el.previewViewFormBtn.classList.remove('active');
}

el.previewViewFormBtn.addEventListener('click', showClientFormInPreview);
el.previewViewQuotationBtn.addEventListener('click', showQuotationInPreview);

el.downloadBtn.addEventListener('click', () => {
  const doc = state.generatedDocs[state.activeOutputIndex];
  if (!doc) return;
  downloadHtml(doc.html, doc.fileName);
});

function downloadHtml(html, fileName) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Prints a standalone HTML document by opening it in a new tab, so pagination uses the document's own content rather than trying to print an embedded iframe. */
function printHtml(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    alert('Please allow pop-ups for this site to print or save as PDF.');
    return;
  }
  win.addEventListener('load', () => {
    win.focus();
    win.print();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

el.printBtn.addEventListener('click', () => {
  const doc = state.generatedDocs[state.activeOutputIndex];
  if (doc) printHtml(doc.html);
});
el.printComparisonBtn.addEventListener('click', () => {
  if (state.comparisonHtml) printHtml(state.comparisonHtml);
});

el.outputBackBtn.addEventListener('click', () => showStage('review'));
el.outputStartOverBtn.addEventListener('click', resetAll);

function resetAll() {
  state.quotations = [];
  state.activeReviewIndex = 0;
  state.activeOutputIndex = 0;
  state.generatedDocs = [];
  state.comparisonHtml = null;
  el.quotationNumberInput.value = '';
  el.validUntilInput.value = '';
  el.ackCheckbox.checked = false;
  clearUploadNotice();
  renderFileList();
  updateContinueButton();
  showStage('upload');
}

showStage('upload');
