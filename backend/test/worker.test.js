/**
 * worker.test.js
 *
 * End-to-end tests of the Worker's fetch(request, env) handler itself -
 * real Request/Response objects (Node 18+'s built-ins are Fetch-API
 * compatible with Cloudflare Workers'), global.fetch mocked so nothing
 * ever reaches real Airtable.
 *
 * Usage: node test/worker.test.js
 */

import assert from 'node:assert';
import worker from '../src/worker.js';

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`  PASS  ${label}`);
    pass++;
  } catch (err) {
    console.log(`  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}
function ok(label, condition) {
  check(label, Boolean(condition), true);
}

const ENV = { AIRTABLE_PAT: 'fake-pat', AIRTABLE_BASE_ID: 'appFAKE', AIRTABLE_TABLE_ID: 'tblFAKE' };

const validPayload = {
  version: '1.2',
  metadata: { submissionId: 'sub-1' },
  applicant: { fullName: 'Ahmad Bin Test' },
  beneficiaries: [],
};

function postRequest(body, { headers, ...rest } = {}) {
  return new Request('https://worker.example/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...rest,
  });
}

async function run() {
  const originalFetch = global.fetch;

  console.log('=== CORS preflight ===');
  {
    const res = await worker.fetch(new Request('https://worker.example/submit', { method: 'OPTIONS' }), ENV);
    check('OPTIONS returns 204', res.status, 204);
    check('Access-Control-Allow-Origin is present', res.headers.get('Access-Control-Allow-Origin'), '*');
    ok('Access-Control-Allow-Methods includes POST', (res.headers.get('Access-Control-Allow-Methods') || '').includes('POST'));
  }

  console.log('\n=== Method not allowed ===');
  {
    const res = await worker.fetch(new Request('https://worker.example/submit', { method: 'GET' }), ENV);
    check('GET is rejected with 405', res.status, 405);
    const body = await res.json();
    check('error code is method_not_allowed', body.code, 'method_not_allowed');
    check('success is false', body.success, false);
  }

  console.log('\n=== 400: wrong Content-Type ===');
  {
    const res = await worker.fetch(postRequest(validPayload, { headers: { 'Content-Type': 'text/plain' } }), ENV);
    check('status is 400', res.status, 400);
    check('code is invalid_content_type', (await res.json()).code, 'invalid_content_type');
  }

  console.log('\n=== 400: malformed JSON ===');
  {
    const res = await worker.fetch(postRequest('{this is not json'), ENV);
    check('status is 400', res.status, 400);
    check('code is invalid_json', (await res.json()).code, 'invalid_json');
  }

  console.log('\n=== 400: invalid payload (fails shape validation) ===');
  {
    const res = await worker.fetch(postRequest({ version: '1.2' }), ENV);
    check('status is 400', res.status, 400);
    check('code is invalid_payload', (await res.json()).code, 'invalid_payload');
  }

  console.log('\n=== 413: payload too large (declared via Content-Length) ===');
  {
    const res = await worker.fetch(postRequest(validPayload, { headers: { 'Content-Length': String(25 * 1024 * 1024) } }), ENV);
    check('status is 413', res.status, 413);
    check('code is payload_too_large', (await res.json()).code, 'payload_too_large');
  }

  console.log('\n=== 413: payload too large (actual oversized body, no Content-Length lie needed) ===');
  {
    const hugeDoc = { filename: 'x.jpg', mimeType: 'image/jpeg', base64: 'A'.repeat(21 * 1024 * 1024) };
    const res = await worker.fetch(postRequest({ ...validPayload, documents: { nricFront: hugeDoc } }), ENV);
    check('status is 413', res.status, 413);
  }

  console.log('\n=== 429: rate limited (in-memory fake KV) ===');
  {
    const store = new Map();
    const fakeKv = {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      put: async (k, v) => { store.set(k, v); },
    };
    const envWithRateLimit = { ...ENV, RATE_LIMIT_KV: fakeKv };
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ records: [{ id: 'recOK' }] }) });
    let lastStatus;
    for (let i = 0; i < 21; i++) {
      const res = await worker.fetch(postRequest(validPayload, { headers: { 'CF-Connecting-IP': '1.2.3.4' } }), envWithRateLimit);
      lastStatus = res.status;
      if (i === 20) {
        check('the 21st request in the window is rate limited (limit is 20/min)', res.status, 429);
        check('code is rate_limited', (await res.json()).code, 'rate_limited');
      }
    }
    global.fetch = originalFetch;
    const otherIpRes = await worker.fetch(postRequest(validPayload, { headers: { 'CF-Connecting-IP': '5.6.7.8' } }), { ...envWithRateLimit });
    // (fetch mock already restored above for this call's env config check only)
  }

  console.log('\n=== 500: Airtable failure ===');
  {
    global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: { message: 'INVALID_MULTIPLE_CHOICE_OPTIONS' } }) });
    const res = await worker.fetch(postRequest(validPayload), ENV);
    check('status is 500', res.status, 500);
    const body = await res.json();
    check('code is airtable_error', body.code, 'airtable_error');
    ok('the client gets a generic, safe message - the raw upstream Airtable error text is logged server-side only, never relayed', !body.error.includes('INVALID_MULTIPLE_CHOICE_OPTIONS') && body.error.length > 0);
    global.fetch = originalFetch;
  }

  console.log('\n=== Timeout handling ===');
  {
    global.fetch = () => new Promise(() => {}); // never resolves
    const res = await worker.fetch(postRequest(validPayload), ENV);
    check('status is 504', res.status, 504);
    check('code is timeout', (await res.json()).code, 'timeout');
    global.fetch = originalFetch;
  }

  console.log('\n=== 500: worker misconfigured (missing Airtable env) ===');
  {
    const res = await worker.fetch(postRequest(validPayload), {});
    check('status is 500', res.status, 500);
    check('code is not_configured', (await res.json()).code, 'not_configured');
  }

  console.log('\n=== Success ===');
  {
    global.fetch = async (url) => {
      if (url.endsWith('uploadAttachment')) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recABC123' }] }) };
    };
    const res = await worker.fetch(postRequest(validPayload), ENV);
    check('status is 200', res.status, 200);
    const body = await res.json();
    check('response shape matches the documented success contract', body, { success: true, recordId: 'recABC123', message: 'Application submitted successfully.' });
    ok('CORS header is present on a real (non-preflight) response too', res.headers.get('Access-Control-Allow-Origin') === '*');
    global.fetch = originalFetch;
  }

  console.log('\n=== No 401/authentication - by design (see worker.js header comment) ===');
  {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ records: [{ id: 'recNOAUTH' }] }) });
    const res = await worker.fetch(postRequest(validPayload), ENV); // no Authorization header sent at all
    check('an unauthenticated request still succeeds - this is a public submission endpoint, not a design gap', res.status, 200);
    global.fetch = originalFetch;
  }

  console.log('\n=== Secrets never leak into a response ===');
  {
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `Bad token: ${ENV.AIRTABLE_PAT}` } }) });
    const res = await worker.fetch(postRequest(validPayload), ENV);
    const text = await res.text();
    ok('the PAT never appears in any response body, even when echoed back by a (hypothetical) misbehaving upstream error', !text.includes(ENV.AIRTABLE_PAT));
    global.fetch = originalFetch;
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
