/**
 * AirtableDestination.js
 *
 * CLIENT-RUNTIME destination adapter - the ONLY file in this project
 * allowed to know Airtable exists. Everything else (UI, SubmissionService,
 * SubmissionQueue, the payload model) only ever deals in the generic
 * destination interface `send(payload) -> Promise<{ reference }>`.
 *
 * --- Why this is a webhook relay, not a direct Airtable API call ---
 *
 * A sibling file in this project, "PruBSN Client Form - Standalone
 * updated.html" (outside this repo, see docs/ROADMAP.md), already POSTs
 * straight to api.airtable.com from browser JS with a live, full
 * read/write Personal Access Token embedded in the page source - visible
 * to anyone who view-sources a file that gets emailed/WhatsApp'd to
 * clients. That is a real, currently-exploitable credential leak, and
 * this file must not repeat the pattern: this quotation document is the
 * exact same kind of client-facing, downloadable, view-sourceable HTML.
 *
 * Instead, this adapter POSTs the standardized submission payload as-is
 * to an Airtable Automation's "When webhook received" trigger URL. That
 * URL is a write-once trigger endpoint scoped to one Automation - not a
 * base-wide, full read/write credential - and it is configured entirely
 * inside Airtable's own UI (no separate backend/hosting required):
 *
 *   1. In the target Airtable base, add an Automation with trigger
 *      "When webhook received". Airtable generates the trigger URL -
 *      paste it into AIRTABLE_WEBHOOK_URL below.
 *   2. Add a "Create record" (or "Run script") action that reads fields
 *      off the incoming JSON body (this file's `payload` argument -
 *      see models/SubmissionPayload.js for the full shape: { version,
 *      quotation, plansCompared, selectedPlan, selectedPlanDetails,
 *      agent, applicant, beneficiaries, employment, family,
 *      medicalHistory, bank, documents, metadata }) and maps them onto
 *      the "Clients" table's columns - see
 *      docs/AIRTABLE_FIELD_MAPPING.md for the full field-by-field
 *      mapping and setup notes (select-option casing, attachment
 *      base64 handling). That mapping lives entirely in Airtable's
 *      Automation editor - never in this codebase, so "no Airtable
 *      schema outside the adapter" holds even though there IS a
 *      schema, it's just not here.
 *   3. Optionally configure the Automation to respond with a JSON body
 *      containing `{ reference: "<your record id>" }` so the client sees
 *      a real Airtable-side reference; if omitted, this adapter falls
 *      back to a locally-generated reference derived from the payload's
 *      own submissionId.
 *
 * Until configured (either edit the default below, or call
 * `configure({ webhookUrl })` once at startup - e.g. from
 * clientRuntime.js, instead of hand-editing this file), send() rejects
 * with a `not_configured` error rather than silently no-oping or
 * guessing a placeholder URL. `configure()` also exists so tests can
 * exercise the real request-building logic against a mocked `fetch`
 * without ever pointing at a live endpoint.
 */

'use strict';

let webhookUrl = null;

const DEFAULT_TIMEOUT_MS = 15000;

function configure(options) {
  webhookUrl = (options && options.webhookUrl) || null;
}

function createTypedError(type, message) {
  const err = new Error(message);
  err.type = type;
  return err;
}

function fallbackReference(payload) {
  const submissionId = payload && payload.metadata && payload.metadata.submissionId;
  return submissionId ? `AT-${String(submissionId).slice(0, 8).toUpperCase()}` : `AT-${Date.now().toString(36).toUpperCase()}`;
}

async function send(payload) {
  if (!webhookUrl) {
    throw createTypedError('not_configured', 'AirtableDestination: webhookUrl is not set. See this file\'s header for setup steps.');
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;

  let response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw createTypedError('timeout', 'AirtableDestination: request timed out.');
    }
    throw createTypedError('network', `AirtableDestination: network error - ${err && err.message ? err.message : err}`);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    throw createTypedError('http_error', `AirtableDestination: webhook responded with HTTP ${response.status}`);
  }

  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    // Webhook responded 2xx with no/invalid JSON body - not an error,
    // the Automation simply wasn't configured to echo a reference back.
  }

  return { reference: (body && body.reference) || fallbackReference(payload) };
}

const AirtableDestination = { name: 'airtable', send, configure };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AirtableDestination;
}
