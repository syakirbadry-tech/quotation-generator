/**
 * ConfirmationPage.js
 *
 * CLIENT-RUNTIME module - renders the final screen after Submit. Phase 5
 * replaces the earlier "preview build" JSON dump with a real
 * success/pending/failed view driven by clientRuntime.js's submission
 * state: reference number, submission time, status, and agent name on
 * success; a plain-language reason plus a "Retry Submission" button on
 * failure - retrying never asks the client to refill the form, since
 * clientRuntime.js reuses the exact same payload it already built.
 *
 * Deliberately renders only the small `view` object clientRuntime.js
 * hands it ({ status, reference, submittedAt, agentName, error }), never
 * the full submission payload - there is no developer/debug JSON output
 * on this screen anymore.
 */

'use strict';

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function na(value) {
  return value == null || String(value).trim() === '' ? '<span class="paf-na">Not available</span>' : escapeHtml(value);
}

function summaryRow(label, value) {
  return `<div class="paf-summary-row"><span class="paf-summary-label">${escapeHtml(label)}</span><span class="paf-summary-value">${value}</span></div>`;
}

const ERROR_MESSAGES = {
  validation: 'There was a problem with your application details.',
  timeout: 'The connection timed out before a response was received.',
  network: "We couldn't reach the server. Please check your internet connection.",
  not_configured: 'Submission is not available right now. Please contact your agent.',
  http_error: 'The server rejected the submission.',
  server: 'The submission service was unavailable.',
  unknown: 'Something went wrong while submitting your application.',
};

function friendlyErrorMessage(error) {
  const type = error && error.type;
  return (type && ERROR_MESSAGES[type]) || ERROR_MESSAGES.unknown;
}

function renderPending() {
  return `
    <div class="paf-step paf-confirmation" data-step-id="confirmation">
      <div class="paf-confirm-icon" aria-hidden="true">&#8943;</div>
      <h3 class="paf-step-title">Submitting Your Application&hellip;</h3>
      <p class="paf-step-subtitle">Please wait a moment. Do not close this window.</p>
    </div>`;
}

function renderSuccess(view) {
  const submittedAt = view.submittedAt ? new Date(view.submittedAt).toLocaleString() : null;
  return `
    <div class="paf-step paf-confirmation" data-step-id="confirmation">
      <div class="paf-confirm-icon" aria-hidden="true">&#10003;</div>
      <h3 class="paf-step-title">Application Submitted</h3>
      <p class="paf-step-subtitle">Thank you. Your application has been received.</p>
      <div class="paf-review-section">
        ${summaryRow('Reference Number', na(view.reference))}
        ${summaryRow('Submission Time', submittedAt ? escapeHtml(submittedAt) : na(null))}
        ${summaryRow('Submission Status', 'Confirmed')}
        ${summaryRow('Agent Name', na(view.agentName))}
      </div>
      <p class="paf-confirm-note">Your agent will follow up to complete processing of this application.</p>
    </div>`;
}

function renderFailed(view) {
  return `
    <div class="paf-step paf-confirmation" data-step-id="confirmation">
      <div class="paf-confirm-icon" aria-hidden="true">&#10007;</div>
      <h3 class="paf-step-title">Submission Failed</h3>
      <p class="paf-step-subtitle">${escapeHtml(friendlyErrorMessage(view.error))}</p>
      <p class="paf-confirm-note">Your details have been saved on this device. Retrying will not ask you to fill in the form again.</p>
      <div class="paf-nav">
        <span></span>
        <button type="button" class="paf-btn paf-btn-primary" data-action="retry">Retry Submission</button>
      </div>
    </div>`;
}

/**
 * @param {{status: 'pending'|'success'|'failed', reference?: string, submittedAt?: string, agentName?: string, error?: {type: string, message: string}}} view
 * @returns {string} HTML for the confirmation screen
 */
function renderConfirmationHtml(view) {
  const v = view || {};
  if (v.status === 'success') return renderSuccess(v);
  if (v.status === 'failed') return renderFailed(v);
  return renderPending();
}

const PruBSNConfirmationPage = { renderConfirmationHtml };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PruBSNConfirmationPage;
}
