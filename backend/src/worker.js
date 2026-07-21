/**
 * worker.js
 *
 * Cloudflare Worker - the backend submission service that replaces the
 * browser's direct POST to the Airtable webhook (which cannot work at
 * all: Airtable's webhook trigger does not send CORS headers, so no
 * browser fetch() to it ever succeeds, from any origin - verified via
 * curl, a real preflight simulation, and real browser fetch() attempts;
 * see the production audit this migration responds to). This Worker is
 * the ONLY thing in the whole system that holds the Airtable Personal
 * Access Token - it is never present in any file the browser loads.
 *
 * Request flow: CORS preflight -> method/size/content-type checks ->
 * JSON parse -> payload shape validation -> optional rate limit ->
 * map payload to Clients table fields (see ./airtable.js, which mirrors
 * ../../docs/AIRTABLE_FIELD_MAPPING.md) -> create the record -> best-
 * effort upload of any attached documents -> JSON response.
 *
 * No authentication (401) is implemented on this endpoint by design: it
 * receives a client's own application submission from their own browser,
 * with no login system anywhere in this project. A shared "API key"
 * baked into the frontend bundle would be visible to anyone who
 * view-sources the page (the exact anti-pattern this whole migration
 * exists to avoid repeating - see docs/AIRTABLE_FIELD_MAPPING.md and
 * destinations/AirtableDestination.js's original header comment), so it
 * would not add real security, only the appearance of it.
 */

import { validatePayloadShape, parseJsonBody, checkContentLength } from './validate.js';
import { submitToClientsTable } from './airtable.js';
import { checkRateLimit } from './rateLimit.js';

const AIRTABLE_TIMEOUT_MS = 15000;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

function fail(error, code, status, env) {
  return json({ success: false, error, code }, status, env);
}

function getClientIp(request) {
  // Cloudflare's own header on real traffic; falls back gracefully in
  // any other environment (local dev, tests) where it's simply absent.
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

/** Wraps the Airtable round-trip with its own timeout, distinct from "Airtable returned an error" - a hung connection should not hang this Worker's response indefinitely. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Timed out contacting Airtable.'), { isTimeout: true })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function handleSubmit(request, env) {
  const missingConfig = ['AIRTABLE_PAT', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_ID'].filter((k) => !env[k]);
  if (missingConfig.length) {
    console.error('Worker misconfigured - missing:', missingConfig.join(', '));
    return fail('Submission service is not configured.', 'not_configured', 500, env);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return fail('Content-Type must be application/json.', 'invalid_content_type', 400, env);
  }

  const lengthError = checkContentLength(Number(request.headers.get('Content-Length')) || null);
  if (lengthError) return fail(lengthError, 'payload_too_large', 413, env);

  const clientIp = getClientIp(request);
  const rl = await checkRateLimit(env.RATE_LIMIT_KV, clientIp);
  if (rl.limited) {
    return fail('Too many submissions from this connection - please wait a minute and try again.', 'rate_limited', 429, env);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch (e) {
    return fail('Could not read the request body.', 'invalid_body', 400, env);
  }

  const parsed = parseJsonBody(rawBody);
  if (parsed.error) {
    const isSize = parsed.error.startsWith('Payload too large');
    return fail(parsed.error, isSize ? 'payload_too_large' : 'invalid_json', isSize ? 413 : 400, env);
  }

  const shapeError = validatePayloadShape(parsed.payload);
  if (shapeError) {
    return fail(shapeError, 'invalid_payload', 400, env);
  }

  try {
    const { recordId, attachmentErrors } = await withTimeout(submitToClientsTable(env, parsed.payload), AIRTABLE_TIMEOUT_MS);
    if (attachmentErrors.length) {
      // Non-fatal by design (see airtable.js) - logged for follow-up, not surfaced as a failure to the client.
      console.error('Document upload failures for record', recordId, attachmentErrors);
    }
    return json({ success: true, recordId, message: 'Application submitted successfully.' }, 200, env);
  } catch (err) {
    if (err && err.isTimeout) {
      return fail('Timed out reaching Airtable. Please try again.', 'timeout', 504, env);
    }
    // The upstream (Airtable) error text is logged server-side only, never
    // relayed verbatim to the client - an error message is upstream-
    // controlled content this Worker doesn't fully trust, the same reason
    // request bodies aren't trusted. It's very unlikely Airtable would
    // ever echo back something sensitive, but "unlikely" isn't a reason
    // to forward untrusted text into a public HTTP response by default.
    console.error('Airtable submission failed:', err && err.message);
    return fail('Could not submit to Airtable. Please try again, or contact your agent if this keeps happening.', 'airtable_error', 500, env);
  }
}

async function fetchHandler(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }
  if (request.method !== 'POST') {
    return fail('Method not allowed - use POST.', 'method_not_allowed', 405, env);
  }

  try {
    return await handleSubmit(request, env);
  } catch (err) {
    // Last-resort catch: an unexpected exception anywhere above must still
    // produce a well-formed JSON error response, not a raw 5xx with no
    // body (or worse, an unhandled-rejection crash of the isolate).
    console.error('Unexpected error in submission handler:', err && err.stack);
    return fail('An unexpected error occurred.', 'internal_error', 500, env);
  }
}

export default { fetch: fetchHandler };
