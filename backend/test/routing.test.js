/**
 * routing.test.js
 *
 * End-to-end tests of the Worker's Phase 9 routes (POST /publish, GET
 * /q/:id, GET /app/:id) via the real fetch(request, env) handler - same
 * approach as worker.test.js, with fakeD1.js standing in for the real D1
 * binding (see that file's header comment for why).
 *
 * Usage: node test/routing.test.js
 */

import assert from 'node:assert';
import worker from '../src/worker.js';
import { createFakeD1 } from './fakeD1.js';

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

const validPublishPayload = {
  clientName: 'Santun Syafitri Binti Mulyadi',
  plan: 'PruBSN AnugerahMax',
  monthlyTotalPayable: 'RM 176.00',
  annualContribution: 'RM 2,112',
  rendererVersion: 'narrative-v1',
  quotationJson: { client: { fullName: 'Santun Syafitri Binti Mulyadi' } },
  generatedHtml: '<!doctype html><div id="pq-doc">the quotation</div>',
};

function publishRequest(body, { headers, ...rest } = {}) {
  return new Request('https://worker.example/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...rest,
  });
}

async function run() {
  console.log('=== POST /publish: not configured (no D1 binding) ===');
  {
    const res = await worker.fetch(publishRequest(validPublishPayload), {});
    check('status is 500', res.status, 500);
    check('code is not_configured', (await res.json()).code, 'not_configured');
  }

  const envWithDb = () => ({ QUOTATIONS_DB: createFakeD1() });

  console.log('\n=== POST /publish: success ===');
  let publishedId;
  let publishedUrl;
  {
    const env = envWithDb();
    const res = await worker.fetch(publishRequest(validPublishPayload), env);
    check('status is 200', res.status, 200);
    const body = await res.json();
    ok('response has success:true', body.success === true);
    ok('response has an id shaped like {slug}-{8-hex-chars}', /^santun-syafitri-binti-mulyadi-[0-9a-f]{8}$/.test(body.id));
    ok('response has a url containing the id', body.url && body.url.includes(body.id));
    ok('response has a generatedDate', Boolean(body.generatedDate));
    publishedId = body.id;
    publishedUrl = body.url;

    console.log('\n=== GET /q/:id: the just-published quotation ===');
    const getRes = await worker.fetch(new Request(publishedUrl), env);
    check('status is 200', getRes.status, 200);
    check('Content-Type is text/html', (getRes.headers.get('Content-Type') || '').split(';')[0], 'text/html');
    const getBody = await getRes.text();
    check('serves the exact stored HTML back, byte-for-byte', getBody, validPublishPayload.generatedHtml);

    console.log('\n=== GET /app/:id: same document, different path prefix ===');
    const appRes = await worker.fetch(new Request(`https://worker.example/app/${publishedId}`), env);
    check('status is 200', appRes.status, 200);
    check('serves the same stored HTML', await appRes.text(), validPublishPayload.generatedHtml);
  }

  console.log('\n=== GET /q/:id: unknown id -> 404, not an error page leaking internals ===');
  {
    const env = envWithDb();
    const res = await worker.fetch(new Request('https://worker.example/q/no-such-quotation-00000000'), env);
    check('status is 404', res.status, 404);
    const body = await res.text();
    ok('is a friendly HTML page, not a JSON error or stack trace', body.includes('<title>') && !body.includes('Error'));
  }

  console.log('\n=== POST /publish: 400 invalid payload (missing clientName) ===');
  {
    const env = envWithDb();
    const res = await worker.fetch(publishRequest({ ...validPublishPayload, clientName: undefined }), env);
    check('status is 400', res.status, 400);
    check('code is invalid_payload', (await res.json()).code, 'invalid_payload');
  }

  console.log('\n=== POST /publish: 400 wrong Content-Type ===');
  {
    const env = envWithDb();
    const res = await worker.fetch(publishRequest(validPublishPayload, { headers: { 'Content-Type': 'text/plain' } }), env);
    check('status is 400', res.status, 400);
    check('code is invalid_content_type', (await res.json()).code, 'invalid_content_type');
  }

  console.log('\n=== POST /publish: 400 malformed JSON ===');
  {
    const env = envWithDb();
    const res = await worker.fetch(publishRequest('{not json'), env);
    check('status is 400', res.status, 400);
    check('code is invalid_json', (await res.json()).code, 'invalid_json');
  }

  console.log('\n=== POST /publish: content that isn\'t this renderer\'s own output is rejected ===');
  {
    const env = envWithDb();
    const res = await worker.fetch(publishRequest({ ...validPublishPayload, generatedHtml: '<div>arbitrary content, not a quotation</div>' }), env);
    check('status is 400', res.status, 400);
    check('code is invalid_payload', (await res.json()).code, 'invalid_payload');
  }

  console.log('\n=== POST /publish: rate limiting reuses the same KV-backed limiter as /submit ===');
  {
    const env = { ...envWithDb(), RATE_LIMIT_KV: (() => {
      const store = new Map();
      return {
        async get(key) { return store.has(key) ? String(store.get(key)) : null; },
        async put(key, value) { store.set(key, Number(value)); },
      };
    })() };
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await worker.fetch(publishRequest(validPublishPayload, { headers: { 'CF-Connecting-IP': '9.9.9.9' } }), env);
      if (res.status === 429) { limited = true; break; }
    }
    ok('enough rapid publishes from the same IP eventually get rate-limited', limited);
  }

  console.log('\n=== Method not allowed on the new routes ===');
  {
    const env = envWithDb();
    const getPublish = await worker.fetch(new Request('https://worker.example/publish', { method: 'GET' }), env);
    check('GET /publish is 405', getPublish.status, 405);

    const postQ = await worker.fetch(new Request('https://worker.example/q/whatever', { method: 'POST' }), env);
    check('POST /q/:id is 405', postQ.status, 405);
  }

  console.log('\n=== Unknown path entirely -> 404 JSON, not a crash ===');
  {
    const res = await worker.fetch(new Request('https://worker.example/nonexistent'), {});
    check('status is 404', res.status, 404);
    check('code is not_found', (await res.json()).code, 'not_found');
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
