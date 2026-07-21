/**
 * AirtableDestination.js
 *
 * CLIENT-RUNTIME destination adapter - the ONLY file in this project
 * allowed to know how a submission actually reaches Airtable. Everything
 * else (UI, SubmissionService, SubmissionQueue, the payload model) only
 * ever deals in the generic destination interface
 * `send(payload) -> Promise<{ reference }>` - that interface, and every
 * other frontend behaviour, is unchanged by this file's internals.
 *
 * --- Why this posts to our own backend, not straight to Airtable ---
 *
 * This adapter used to POST directly to an Airtable Automation's
 * webhook trigger URL. A production audit found that architecture
 * cannot work at all: Airtable's webhook endpoint does not send
 * Access-Control-Allow-Origin (or any other CORS) headers, so a
 * browser's fetch() to it is blocked by CORS before the request ever
 * completes - from ANY origin (file://, a hosted http(s) origin,
 * everything). Verified independently three ways: a real fetch() from
 * both file:// and http://localhost failed with "Failed to fetch"; curl
 * to the same URL succeeded fine (ruling out network/DNS issues) but
 * the response carried no Access-Control-Allow-Origin header; and
 * simulating the browser's exact CORS preflight (OPTIONS with
 * Access-Control-Request-Method) got a 200 back with no CORS headers
 * either. No client submission was ever actually reaching Airtable this
 * way, in production or otherwise.
 *
 * The fix is a small backend (Cloudflare Worker, see backend/) that:
 *   - DOES send proper CORS headers, so the browser's fetch() succeeds
 *   - holds the real Airtable Personal Access Token server-side only -
 *     it is never present in any file the browser loads, so this
 *     quotation document (client-facing, downloadable, view-sourceable
 *     HTML, same as the legacy standalone intake form whose embedded
 *     PAT was the original reason this project never talks to Airtable
 *     directly from the browser - see docs/AIRTABLE_FIELD_MAPPING.md)
 *     still never carries a real credential
 *   - maps the payload onto the Clients table itself via Airtable's
 *     REST API (see backend/src/airtable.js, which mirrors
 *     docs/AIRTABLE_FIELD_MAPPING.md exactly) - no Airtable Automation
 *     is involved anymore, so this codebase's own copy of the field
 *     mapping is now the only one that matters, not a copy living
 *     inside Airtable's Automation editor
 *
 * Until configured (either edit the default below, or call
 * `configure({ endpointUrl })` once at startup - e.g. from
 * clientRuntime.js, instead of hand-editing this file), send() rejects
 * with a `not_configured` error rather than silently no-oping or
 * guessing a placeholder URL. `configure()` also exists so tests can
 * exercise the real request-building logic against a mocked `fetch`
 * without ever pointing at a live endpoint.
 */

'use strict';

let endpointUrl = null;

const DEFAULT_TIMEOUT_MS = 15000;

function configure(options) {
  endpointUrl = (options && options.endpointUrl) || null;
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

/**
 * Maps the backend's `code` (see backend/src/worker.js) onto this
 * project's existing typed-error vocabulary
 * (not_configured/timeout/network/validation/server/http_error - see
 * ConfirmationPage.js's ERROR_MESSAGES) so every other file downstream
 * of `send()` needs no changes at all for this migration.
 */
function typeForBackendCode(code) {
  switch (code) {
    case 'not_configured':
      return 'not_configured';
    case 'timeout':
      return 'timeout';
    case 'rate_limited':
      return 'rate_limited';
    case 'invalid_content_type':
    case 'invalid_json':
    case 'invalid_payload':
    case 'payload_too_large':
    case 'method_not_allowed':
      return 'validation';
    default:
      return 'server';
  }
}

async function send(payload) {
  if (!endpointUrl) {
    throw createTypedError('not_configured', 'AirtableDestination: endpointUrl is not set. See this file\'s header for setup steps.');
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;

  let response;
  try {
    response = await fetch(endpointUrl, {
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

  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    // No/invalid JSON body - the backend always sends one (see
    // backend/src/worker.js), so this means something else entirely
    // returned a response (a proxy, a misconfigured URL pointing at the
    // wrong thing). Treated as an http_error below either way.
  }

  if (!response.ok || !body || body.success !== true) {
    const code = body && body.code;
    const type = code ? typeForBackendCode(code) : 'http_error';
    const message = (body && body.error) || `AirtableDestination: backend responded with HTTP ${response.status}`;
    throw createTypedError(type, message);
  }

  return { reference: body.recordId || fallbackReference(payload) };
}

const AirtableDestination = { name: 'airtable', send, configure };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AirtableDestination;
}
