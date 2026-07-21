/**
 * ReviewPage.js
 *
 * CLIENT-RUNTIME module - renders Step 5 ("Review"): a read-only summary
 * of the quotation (plan, monthly contribution, optional riders,
 * quotation number/validity), the read-only agent information, and every
 * field the client entered across Steps 1-4, each with an "Edit" link
 * back to its step. Per spec: "Allow editing before submission" - this
 * file only renders the summary + edit hooks; clientRuntime.js wires the
 * edit links to actual step navigation and the values here always come
 * from the live form state (a plain object), never re-derived from the
 * DOM.
 */

'use strict';

const { STEP_DEFS } = require('./ApplicationForm');

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function na(value) {
  return value == null || String(value).trim() === '' ? '<span class="paf-na">Not provided</span>' : escapeHtml(value);
}

function summaryRow(label, value) {
  return `<div class="paf-summary-row"><span class="paf-summary-label">${escapeHtml(label)}</span><span class="paf-summary-value">${value}</span></div>`;
}

function renderQuotationSummary(quotation) {
  const q = quotation || {};
  const riders = Array.isArray(q.riders) && q.riders.length
    ? `<ul class="paf-rider-list">${q.riders.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '<span class="paf-na">None selected</span>';

  return `
    <section class="paf-review-section">
      <h4 class="paf-review-heading">Quotation Summary</h4>
      ${summaryRow('Quotation Number', na(q.quotationNumber))}
      ${summaryRow('Valid Until', na(q.validUntil))}
      ${summaryRow('Base Plan', na(q.planName))}
      ${summaryRow('Monthly Total Amount Payable', na(q.monthlyContribution))}
      <div class="paf-summary-row paf-summary-row-block">
        <span class="paf-summary-label">Optional Riders</span>
        <div class="paf-summary-value">${riders}</div>
      </div>
    </section>`;
}

function renderAgentInfo(agent) {
  const a = agent || {};
  return `
    <section class="paf-review-section">
      <h4 class="paf-review-heading">Agent Information <span class="paf-readonly-tag">Read-only</span></h4>
      ${summaryRow('Agent Name', na(a.name))}
      ${summaryRow('Agency', na(a.agency))}
      ${summaryRow('Branch', na(a.branch))}
      ${summaryRow('Contact', na(a.phone || a.email))}
    </section>`;
}

/** Renders one field's review row - `file` fields read from `files` (never `values`), `plan-cards` shows the chosen plan name as plain text. */
function fieldSummaryRow(field, values, files) {
  if (field.type === 'file') {
    const file = files[field.name];
    return summaryRow(field.label, file ? escapeHtml(file.name) : '<span class="paf-na">Not uploaded</span>');
  }
  if (field.type === 'plan-cards') {
    return summaryRow(field.label, na(values[field.name]));
  }
  return summaryRow(field.label, na(values[field.name]));
}

/**
 * @param {object} prefillData compose-time object from buildPrefillData.js: { quotation, plans, agent, client }
 * @param {object} formValues merged field values across all 6 steps (see ApplicationForm.js STEP_DEFS for keys)
 * @param {object} files Documents step File objects, keyed by field name (state.files from clientRuntime.js)
 * @returns {string} HTML for the whole review step (no Submit button - clientRuntime.js owns step nav/actions)
 */
function renderReviewHtml(prefillData, formValues, files) {
  const data = prefillData || {};
  const values = formValues || {};
  const uploadedFiles = files || {};

  const clientSections = STEP_DEFS.map((step, stepIndex) => {
    const rows = step.fields
      .map((f) => fieldSummaryRow(f, values, uploadedFiles))
      .join('');
    return `
      <section class="paf-review-section">
        <h4 class="paf-review-heading">
          ${escapeHtml(step.title)}
          <button type="button" class="paf-edit-link" data-goto-step="${stepIndex}">Edit</button>
        </h4>
        ${rows}
      </section>`;
  }).join('');

  return `
    <div class="paf-step paf-review" data-step-id="review">
      <h3 class="paf-step-title">Review Your Application</h3>
      <p class="paf-step-subtitle">Please check everything below before submitting. You can edit any section.</p>
      ${renderQuotationSummary(data.quotation)}
      ${renderAgentInfo(data.agent)}
      ${clientSections}
    </div>`;
}

const PruBSNReviewPage = { renderReviewHtml };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PruBSNReviewPage;
}
