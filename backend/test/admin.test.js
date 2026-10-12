/**
 * admin.test.js
 *
 * End-to-end tests of the staff dashboard API (/admin/*) via the real
 * fetch(request, env) handler, with global.fetch mocked so nothing ever
 * reaches real Airtable - same approach as worker.test.js.
 *
 * Usage: node test/admin.test.js
 */

import assert from 'node:assert';
import worker from '../src/worker.js';
import { pbkdf2, createSessionToken, verifySessionToken } from '../src/admin.js';

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

const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'https://syakirbadry-tech.github.io';

async function makeEnv() {
  const salt = new Uint8Array(16).fill(7);
  const hash = await pbkdf2(PASSWORD, salt, 1000);
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  return {
    AIRTABLE_PAT: 'fake-pat',
    AIRTABLE_BASE_ID: 'appFAKE',
    AIRTABLE_TABLE_ID: 'tblFAKE',
    ALLOWED_ORIGIN: '*',
    ADMIN_ALLOWED_ORIGIN: ORIGIN,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: `pbkdf2$1000$${b64(salt)}$${b64(hash)}`,
    ADMIN_SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  };
}

function req(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://worker.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const airtableCalls = [];
function mockAirtable(handler) {
  airtableCalls.length = 0;
  global.fetch = async (url, init = {}) => {
    airtableCalls.push({ url: String(url), init });
    const { status = 200, body } = handler(String(url), init);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

async function login(env, username = 'admin', password = PASSWORD) {
  return worker.fetch(req('/admin/login', { method: 'POST', body: { username, password } }), env);
}

async function run() {
  const env = await makeEnv();

  console.log('=== not configured ===');
  {
    const res = await worker.fetch(req('/admin/submissions'), { AIRTABLE_PAT: 'x' });
    check('status 500', res.status, 500);
    check('code not_configured', (await res.json()).code, 'not_configured');
  }

  console.log('=== CORS ===');
  {
    const res = await worker.fetch(req('/admin/login', { method: 'OPTIONS' }), env);
    check('preflight 204', res.status, 204);
    check('origin restricted to dashboard', res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    ok('allows Authorization header', res.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
    const pub = await worker.fetch(req('/submit', { method: 'OPTIONS' }), env);
    check('public /submit CORS unchanged', pub.headers.get('Access-Control-Allow-Origin'), '*');
  }

  console.log('=== login ===');
  {
    const bad = await login(env, 'admin', 'wrong password');
    check('wrong password -> 401', bad.status, 401);
    check('wrong password code', (await bad.json()).code, 'invalid_credentials');

    const badUser = await login(env, 'someone', PASSWORD);
    check('wrong username -> 401', badUser.status, 401);

    const notJson = await worker.fetch(req('/admin/login', { method: 'POST', body: '{nope' }), env);
    check('invalid JSON -> 400', notJson.status, 400);

    const get = await worker.fetch(req('/admin/login'), env);
    check('GET login -> 405', get.status, 405);

    const good = await login(env);
    check('correct credentials -> 200', good.status, 200);
    const body = await good.json();
    ok('returns a token', typeof body.token === 'string' && body.token.includes('.'));
    ok('expires in the future', body.expiresAt > Date.now() / 1000);
    check('no-store', good.headers.get('Cache-Control'), 'no-store');
  }

  console.log('=== session tokens ===');
  {
    const { token } = await createSessionToken(env, 'admin', 1000);
    ok('valid before expiry', await verifySessionToken(env, token, 1001));
    ok('rejected after expiry', !(await verifySessionToken(env, token, 1000 + 9 * 3600)));
    const [claims, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', iat: 0, exp: 9e9 })).toString('base64url');
    ok('forged claims rejected', !(await verifySessionToken(env, `${forged}.${sig}`, 1001)));
    ok('wrong secret rejected', !(await verifySessionToken({ ...env, ADMIN_SESSION_SECRET: 'other' }, token, 1001)));
    ok('garbage rejected', !(await verifySessionToken(env, 'abc', 1001)));
    ok('username change invalidates', !(await verifySessionToken({ ...env, ADMIN_USERNAME: 'new' }, `${claims}.${sig}`, 1001)));
  }

  const { token } = await (await login(env)).json();

  console.log('=== auth required ===');
  {
    mockAirtable(() => ({ body: { records: [] } }));
    const noToken = await worker.fetch(req('/admin/submissions'), env);
    check('no token -> 401', noToken.status, 401);
    const badToken = await worker.fetch(req('/admin/submissions', { token: 'x.y' }), env);
    check('bad token -> 401', badToken.status, 401);
    const detail = await worker.fetch(req('/admin/submissions/recAAAAAAAAAAAAAA'), env);
    check('detail without token -> 401', detail.status, 401);
    check('Airtable never called without auth', airtableCalls.length, 0);
  }

  console.log('=== list submissions ===');
  {
    mockAirtable((url) => {
      if (!url.includes('offset=')) {
        return { body: { offset: 'page2', records: [
          { id: 'recOLD00000000001', createdTime: '2026-07-01T00:00:00.000Z', fields: { 'Full Name': 'Old', 'Submitted At': '2026-07-01T00:00:00.000Z' } },
        ] } };
      }
      return { body: { records: [
        { id: 'recNEW00000000002', createdTime: '2026-10-01T00:00:00.000Z', fields: { 'Full Name': 'New', 'Submission Status': 'Received' } },
      ] } };
    });
    const res = await worker.fetch(req('/admin/submissions', { token }), env);
    check('200', res.status, 200);
    const body = await res.json();
    check('follows pagination', body.submissions.length, 2);
    check('newest first', body.submissions.map((s) => s.fullName), ['New', 'Old']);
    check('summary status', body.submissions[0].status, 'Received');
    ok('only requests summary fields', !airtableCalls[0].url.includes('Account+Number') && airtableCalls[0].url.includes('fields%5B%5D=Full+Name'));
    check('uses the PAT', airtableCalls[0].init.headers.Authorization, 'Bearer fake-pat');
  }

  console.log('=== submission detail ===');
  {
    mockAirtable(() => ({ body: { id: 'recAAAAAAAAAAAAAA', createdTime: 't', fields: { 'Full Name': 'A', 'Account Number': '123' } } }));
    const res = await worker.fetch(req('/admin/submissions/recAAAAAAAAAAAAAA', { token }), env);
    check('200', res.status, 200);
    check('full fields returned', (await res.json()).submission.fields['Account Number'], '123');

    const badId = await worker.fetch(req('/admin/submissions/..%2Fother', { token }), env);
    check('malformed id -> 404', badId.status, 404);

    mockAirtable(() => ({ status: 404, body: { error: 'NOT_FOUND' } }));
    const missing = await worker.fetch(req('/admin/submissions/recBBBBBBBBBBBBBB', { token }), env);
    check('missing record -> 404', missing.status, 404);

    mockAirtable(() => ({ status: 403, body: { error: { type: 'INVALID_PERMISSIONS' } } }));
    const denied = await worker.fetch(req('/admin/submissions', { token }), env);
    check('Airtable error -> 502', denied.status, 502);
    check('upstream message not leaked', (await denied.json()).error.includes('INVALID_PERMISSIONS'), false);
  }

  console.log('=== update status ===');
  {
    mockAirtable((url, init) => ({ body: { id: 'recAAAAAAAAAAAAAA', createdTime: 't', fields: JSON.parse(init.body).fields } }));
    const res = await worker.fetch(req('/admin/submissions/recAAAAAAAAAAAAAA', { method: 'PATCH', token, body: { status: 'Approved' } }), env);
    check('200', res.status, 200);
    check('returns new status', (await res.json()).submission.status, 'Approved');
    check('PATCHes Airtable', airtableCalls[0].init.method, 'PATCH');
    check('only writes the status field', JSON.parse(airtableCalls[0].init.body), { fields: { 'Submission Status': 'Approved' } });

    const bad = await worker.fetch(req('/admin/submissions/recAAAAAAAAAAAAAA', { method: 'PATCH', token, body: { status: 'Hacked' } }), env);
    check('unknown status -> 400', bad.status, 400);
  }

  console.log('=== login rate limit ===');
  {
    const store = new Map();
    const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
    const limitedEnv = { ...env, RATE_LIMIT_KV: kv };
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await login(limitedEnv, 'admin', 'wrong')).status);
    check('6th attempt in a minute is blocked', statuses, [401, 401, 401, 401, 401, 429]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
