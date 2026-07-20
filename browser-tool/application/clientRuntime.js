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

// Phase 6A: live Airtable webhook configured with duplicate prevention (see
// destinations/AirtableDestination.js). Webhook is scoped to this automation
// and POST data is mapped to Applications table via field references.
const ACTIVE_DESTINATION = AirtableDestination.configure({
  webhookUrl: 'https://hooks.airtable.com/workflows/v1/genericWebhook/appcA4lwc8KrLNxwM/wflQdJbGW3L2C8hoC/wtr78zDfdM03qbWWI'
});

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
    errors: {},
    submissionId: null,
    submissionPayload: null,
    submissionStatus: 'idle', // 'idle' | 'pending' | 'success' | 'failed'
    submissionResult: null, // last SubmissionService.submit() result
  };

  const continueBtn = document.getElementById('paf-continue-btn');
  // composeClientDocument.js appends the CTA as a SIBLING right after
  // the renderer's `.sheet` card, not inside it - so the card is found
  // by document-level lookup, not by walking up from the button.
  const quotationCard = document.querySelector('.sheet');

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
      ? ApplicationForm.renderStepHtml(state.currentStep, state.values, state.errors)
      : state.currentStep === REVIEW_STEP
        ? ReviewPage.renderReviewHtml(prefillData, state.values)
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
  }

  function handleNext() {
    persistCurrentStepValues();
    const errors = ApplicationForm.validateStep(state.currentStep, state.values);
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
    if (!state.submissionPayload) {
      state.submissionPayload = buildSubmissionPayload(prefillData, state.values, { submissionId: state.submissionId });
    }

    state.submissionStatus = 'pending';
    goToStep(CONFIRMATION_STEP); // shows a "Submitting..." view immediately

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
  }

  function openFlow() {
    if (quotationCard) quotationCard.hidden = true;
    if (continueBtn) continueBtn.hidden = true;
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
