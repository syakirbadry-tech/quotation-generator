/**
 * clientRuntime.js
 *
 * CLIENT-RUNTIME bundle entry point. This is the file esbuild bundles
 * into browser-tool/dist/application.bundle.js (see
 * scripts/build-browser-tool.js), whose text is then inlined as a
 * compile-time string constant into app.bundle.js and, from there,
 * <script>-injected into the generated client quotation document by
 * composeClientDocument.js.
 *
 * Contract with composeClientDocument.js (the only integration surface):
 *   - This script defines `window.__prubsnInitApplicationFlow(rootEl, prefillData)`.
 *   - It expects a "Continue Application" button somewhere in the
 *     document with id `paf-continue-btn`, and the quotation card itself
 *     to be the closest ancestor of that button carrying class `sheet`
 *     (renderer's own wrapper - see renderer/renderQuotation.js).
 *   - `rootEl` is an initially-hidden container; this module renders the
 *     whole multi-step flow into it and toggles visibility itself.
 *
 * No dependency on parser/ or renderer/ - only ever touches the small
 * sanitized `prefillData` object handed to it at init time.
 */

'use strict';

const ApplicationForm = require('./ApplicationForm');
const ReviewPage = require('./ReviewPage');
const ConfirmationPage = require('./ConfirmationPage');
const { buildSubmissionPayload } = require('../models/SubmissionPayload');
const SubmissionService = require('../services/SubmissionService');
const AirtableDestination = require('../destinations/AirtableDestination');

const REVIEW_STEP = ApplicationForm.TOTAL_STEPS; // index 4
const CONFIRMATION_STEP = ApplicationForm.TOTAL_STEPS + 1; // index 5
const STEP_LABELS = ApplicationForm.STEP_DEFS.map((s) => s.title).concat(['Review']);

// Phase 9: submissions go to our own backend (see backend/), not straight
// to Airtable - a production audit found the direct-webhook architecture
// could never work at all (Airtable's webhook sends no CORS headers, so
// no browser fetch() to it can ever succeed, from any origin - see
// AirtableDestination.js's header comment for the full verification).
// The backend holds the real Airtable credential and maps the payload
// onto the "Clients" table itself (single source of truth for a
// customer's whole application - see docs/AIRTABLE_FIELD_MAPPING.md).
//
// AirtableDestination.configure() is a side-effecting call (it sets the
// module's internal endpointUrl) and returns nothing - the destination
// SubmissionService.submit() needs is the AirtableDestination module
// object itself ({ name, send }), not configure()'s return value.
//
// This is the real, deployed production Worker URL (see
// backend/DEPLOYMENT.md for deployment details) - update it if the
// Worker is ever redeployed under a different name/subdomain.
AirtableDestination.configure({
  endpointUrl: 'https://prubsn-submission-service.syakirbadry.workers.dev/submit'
});
const ACTIVE_DESTINATION = AirtableDestination;

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB per document, enforced client-side before it ever hits the webhook payload

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Malaysian NRIC's first 6 digits are YYMMDD - a courtesy auto-fill, always left editable, never overwriting a value the client already typed by hand. */
function deriveDobFromNric(nricValue) {
  const digits = String(nricValue || '').replace(/\D/g, '').slice(0, 6);
  if (digits.length !== 6) return null;
  const yy = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  const dd = parseInt(digits.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const currentYY = new Date().getFullYear() % 100;
  const century = yy <= currentYY ? 2000 : 1900;
  const pad = (n) => String(n).padStart(2, '0');
  return `${century + yy}-${pad(mm)}-${pad(dd)}`;
}

function generateSubmissionId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Fallback for an environment with no Web Crypto - still unique enough
  // for this file's only use of the id (client-side dedupe/queue key).
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Maps the small compose-time prefill object onto initial form values. Never fabricates a value the parser didn't provide. */
function buildInitialValues(prefillData) {
  const client = (prefillData && prefillData.client) || {};
  return {
    fullName: client.fullName || '',
    dateOfBirth: client.dateOfBirthIso || '',
    gender: client.gender || '',
  };
}

function renderProgressHtml(currentStep) {
  const items = STEP_LABELS.map((label, i) => {
    const status = i < currentStep ? 'done' : i === currentStep ? 'current' : 'upcoming';
    return `<li class="paf-progress-item paf-progress-${status}"><span class="paf-progress-dot">${i + 1}</span><span class="paf-progress-label">${label}</span></li>`;
  }).join('');
  return `<ol class="paf-progress">${items}</ol>`;
}

function renderNavHtml(currentStep) {
  if (currentStep === CONFIRMATION_STEP) return '';
  const backBtn = currentStep > 0
    ? '<button type="button" class="paf-btn paf-btn-secondary" data-action="back">Back</button>'
    : '<span></span>';
  const forwardBtn = currentStep === REVIEW_STEP
    ? '<button type="button" class="paf-btn paf-btn-primary" data-action="submit">Submit Application</button>'
    : '<button type="button" class="paf-btn paf-btn-primary" data-action="next">Next</button>';
  return `<div class="paf-nav">${backBtn}${forwardBtn}</div>`;
}

function initApplicationFlow(rootEl, prefillData) {
  if (!rootEl) return;

  const state = {
    currentStep: 0,
    values: buildInitialValues(prefillData),
    files: {}, // Documents step File objects, keyed by field name - never merged into `values`
    errors: {},
    submissionId: null,
    submissionPayload: null,
    submissionStatus: 'idle', // 'idle' | 'pending' | 'success' | 'failed'
    submissionResult: null, // last SubmissionService.submit() result
  };

  const continueBtn = document.getElementById('paf-continue-btn');
  // composeClientDocument.js appends the CTA as a SIBLING right after the
  // renderer's own root wrapper, not inside it - so the wrapper is found
  // by document-level lookup, not by walking up from the button. `.sheet`
  // is the old medical-card renderer's marker; `#pq-doc` is the current
  // narrative renderer's (see renderer/renderNarrativeQuotation.js).
  const quotationCard = document.querySelector('.sheet, #pq-doc');
  // The fixed-position Print/Save-as-PDF button (composeClientDocument.js)
  // floats over whatever content is scrolled underneath it - found via an
  // actual multi-step form test where it visually obstructed a field near
  // the bottom-right of the viewport. Hidden while the application form is
  // open for the same reason the quotation itself hides then: neither
  // "print the quotation" nor the quotation's own content make sense to
  // show while filling out the form.
  const printBtn = document.getElementById('pq-print-btn');

  function buildConfirmationView() {
    const result = state.submissionResult;
    return {
      status: state.submissionStatus,
      reference: result && result.reference,
      submittedAt: state.submissionPayload && state.submissionPayload.metadata.submittedAt,
      agentName: prefillData && prefillData.agent && prefillData.agent.name,
      error: result && result.error,
    };
  }

  function render() {
    const bodyHtml = state.currentStep < REVIEW_STEP
      ? ApplicationForm.renderStepHtml(state.currentStep, state.values, state.errors, { files: state.files, plans: prefillData && prefillData.plans })
      : state.currentStep === REVIEW_STEP
        ? ReviewPage.renderReviewHtml(prefillData, state.values, state.files)
        : ConfirmationPage.renderConfirmationHtml(buildConfirmationView());

    rootEl.innerHTML = `
      <div class="paf-shell">
        ${state.currentStep <= REVIEW_STEP ? '<button type="button" class="paf-back-link" data-action="close">&larr; Back to quotation</button>' : ''}
        ${state.currentStep <= REVIEW_STEP ? renderProgressHtml(state.currentStep) : ''}
        <div class="paf-step-body">${bodyHtml}</div>
        ${renderNavHtml(state.currentStep)}
      </div>`;

    attachHandlers();
  }

  function goToStep(index) {
    const alreadyThere = state.currentStep === index;
    state.currentStep = index;
    render();
    if (!alreadyThere) rootEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function persistCurrentStepValues() {
    if (state.currentStep >= REVIEW_STEP) return;
    const container = rootEl.querySelector('.paf-step');
    if (!container) return;
    Object.assign(state.values, ApplicationForm.collectStepValues(state.currentStep, container));
    // Courtesy auto-fill: Malaysian NRIC's first 6 digits are YYMMDD. Never
    // overwrites a date the client already entered by hand.
    if (!state.values.dateOfBirth) {
      const derived = deriveDobFromNric(state.values.nric);
      if (derived) state.values.dateOfBirth = derived;
    }
  }

  /** Documents step has no plain-value fields to validate via ApplicationForm.validateStep - it validates File presence in state.files instead. */
  function validateDocumentsStep() {
    const errors = {};
    for (const name of ApplicationForm.stepFileFieldNames(state.currentStep)) {
      const file = state.files[name];
      if (!file) errors[name] = 'Please upload this document.';
      else if (file.size > MAX_FILE_BYTES) errors[name] = 'File is too large - please upload a file under 5MB.';
    }
    return errors;
  }

  function handleNext() {
    persistCurrentStepValues();
    const errors = state.currentStep === ApplicationForm.DOCUMENTS_STEP_INDEX
      ? validateDocumentsStep()
      : ApplicationForm.validateStep(state.currentStep, state.values);
    // The Plan Selection card picker isn't a `[name=...]` form control (see
    // stepFieldNames' comment), so its required-ness isn't covered by
    // ApplicationForm.validateStep - check it separately here.
    if (state.currentStep === ApplicationForm.PLAN_STEP_INDEX && !state.values.plan) {
      errors.plan = 'Please select a plan.';
    }
    if (Object.keys(errors).length > 0) {
      state.errors = errors;
      render();
      return;
    }
    state.errors = {};
    goToStep(state.currentStep + 1);
  }

  function handleBack() {
    persistCurrentStepValues();
    goToStep(Math.max(0, state.currentStep - 1));
  }

  /**
   * Handles both the initial Submit click and every subsequent Retry
   * click - they're the same operation. The payload is built once (on
   * the very first attempt) and reused verbatim on retries: same
   * submissionId, same submittedAt, same applicant data, so the client
   * is never asked to refill anything and the destination can reliably
   * dedupe retries of the same attempt.
   */
  async function handleSubmit() {
    if (state.submissionStatus === 'pending') return; // guards a double-click/rapid re-click race
    if (!state.submissionId) state.submissionId = generateSubmissionId();

    state.submissionStatus = 'pending';
    goToStep(CONFIRMATION_STEP); // shows a "Submitting..." view immediately

    if (!state.submissionPayload) {
      // Documents are converted to base64 once, on the first submit attempt
      // (not on every render) - the same payload, files included, is then
      // reused verbatim on any retry, same as every other field.
      const documents = {};
      for (const [name, file] of Object.entries(state.files)) {
        try {
          documents[name] = { filename: file.name, mimeType: file.type || 'application/octet-stream', base64: await fileToBase64(file) };
        } catch (e) {
          // A file that fails to read client-side is treated as not provided
          // rather than aborting the whole submission - the earlier
          // Documents-step gate already required it to exist and be <5MB.
        }
      }
      state.submissionPayload = buildSubmissionPayload(prefillData, state.values, documents, { submissionId: state.submissionId });
    }

    const result = await SubmissionService.submit(state.submissionPayload, { destination: ACTIVE_DESTINATION });
    state.submissionResult = result;
    state.submissionStatus = result.status; // 'success' | 'failed'
    render();
  }

  function handleClose() {
    persistCurrentStepValues();
    rootEl.hidden = true;
    if (quotationCard) quotationCard.hidden = false;
    if (continueBtn) continueBtn.hidden = false;
    if (printBtn) printBtn.hidden = false;
  }

  function attachHandlers() {
    rootEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (evt) => {
        const action = evt.currentTarget.getAttribute('data-action');
        if (action === 'next') handleNext();
        else if (action === 'back') handleBack();
        else if (action === 'submit') handleSubmit();
        else if (action === 'retry') handleSubmit();
        else if (action === 'close') handleClose();
      });
    });
    rootEl.querySelectorAll('[data-goto-step]').forEach((btn) => {
      btn.addEventListener('click', (evt) => {
        persistCurrentStepValues();
        goToStep(Number(evt.currentTarget.getAttribute('data-goto-step')));
      });
    });
    rootEl.querySelectorAll('[data-file-field]').forEach((input) => {
      input.addEventListener('change', (evt) => {
        const name = evt.currentTarget.getAttribute('data-file-field');
        const file = evt.currentTarget.files && evt.currentTarget.files[0];
        if (!file) return;
        state.files[name] = file;
        if (state.errors[name]) delete state.errors[name];
        render();
      });
    });
    rootEl.querySelectorAll('[data-plan-index]').forEach((card) => {
      const select = () => {
        const idx = Number(card.getAttribute('data-plan-index'));
        const plans = (prefillData && prefillData.plans) || [];
        const chosen = plans[idx];
        if (!chosen) return;
        state.values.plan = chosen.planName || `Option ${idx + 1}`;
        if (state.errors.plan) delete state.errors.plan;
        render();
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); select(); }
      });
    });
  }

  function openFlow() {
    if (quotationCard) quotationCard.hidden = true;
    if (continueBtn) continueBtn.hidden = true;
    if (printBtn) printBtn.hidden = true;
    rootEl.hidden = false;
    render();
    rootEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', openFlow);
  }
}

if (typeof window !== 'undefined') {
  window.__prubsnInitApplicationFlow = initApplicationFlow;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initApplicationFlow };
}
