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
import { pbkdf2, createSessionToken, verifySessionToken, hashPassword } from '../src/admin.js';

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

  await teamTests(env);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

// In-memory stand-in for the two Airtable tables the dashboard uses.
function fakeAirtable({ users, clients }) {
  const created = [];
  let n = 0;
  const newId = () => `recNEW${String(++n).padStart(11, '0')}`;
  const formulaValue = (f) => (/= '((?:[^'\\]|\\.)*)'/.exec(f) || [])[1];
  mockAirtable((url, init) => {
    const u = new URL(url);
    const [, , , table, id] = u.pathname.split('/');
    const rows = table === 'tblUSERS' ? users : clients;
    const method = init.method || 'GET';
    if (method === 'POST' && !id) {
      const body = JSON.parse(init.body);
      const recs = (body.records || [body]).map((r) => ({ id: newId(), createdTime: '2026-10-17T00:00:00.000Z', fields: r.fields }));
      for (const rec of recs) {
        rows.push(rec);
        created.push({ table, rec });
      }
      return { body: body.records ? { records: recs } : recs[0] };
    }
    if (method === 'POST' || (method === 'PATCH' && !id)) return { body: { records: [] } }; // attachment uploads / batch ticks
    if (id) {
      const rec = rows.find((r) => r.id === id);
      if (!rec) return { status: 404, body: { error: 'NOT_FOUND' } };
      if (method === 'PATCH') Object.assign(rec.fields, JSON.parse(init.body).fields);
      return { body: rec };
    }
    const formula = u.searchParams.get('filterByFormula') || '';
    let out = rows;
    if (table === 'tblUSERS' && formula.includes('{Email}')) out = rows.filter((r) => String(r.fields.Email || '').toLowerCase() === formulaValue(formula));
    if (table === 'tblUSERS' && formula.includes('{Form Code}')) out = rows.filter((r) => r.fields['Form Code'] === formulaValue(formula) && r.fields.Active);
    return { body: { records: out } };
  });
  return created;
}

async function teamTests(baseEnv) {
  const env = { ...baseEnv, AIRTABLE_USERS_TABLE_ID: 'tblUSERS' };
  const AGENT_PW = 'agent password 123';
  const agentHash = await hashPassword(AGENT_PW);
  const users = [
    { id: 'recLEADER00000001', fields: { Name: 'Rose Leader', Email: 'rose@example.com', Role: 'Leader', Active: true, 'Form Code': 'rose', 'Password Hash': agentHash } },
    { id: 'recAGENTA00000001', fields: { Name: 'Ain Agent', Email: 'Ain@Example.com', Role: 'Agent', Active: true, 'Form Code': 'ain', 'Password Hash': agentHash } },
    { id: 'recAGENTB00000001', fields: { Name: 'Bee Agent', Email: 'bee@example.com', Role: 'Agent', Active: false, 'Form Code': 'bee', 'Password Hash': agentHash } },
    { id: 'recNEWBIE00000001', fields: { Name: 'New Bie', Email: 'newbie@example.com', Role: 'Agent', Active: true, 'Form Code': 'newbie' } },
  ];
  const clients = [
    { id: 'recCLIENTA0000001', createdTime: '2026-10-01T00:00:00.000Z', fields: { 'Full Name': 'Client of Ain', 'Agent Email': 'ain@example.com', 'Account Number': '111' } },
    { id: 'recCLIENTO0000001', createdTime: '2026-10-02T00:00:00.000Z', fields: { 'Full Name': 'Owner client', 'Account Number': '222' } },
  ];
  fakeAirtable({ users, clients });
  const loginAs = async (username, password = AGENT_PW) => (await login(env, username, password)).json();

  console.log('=== team logins ===');
  {
    const agent = await loginAs('ain@example.com');
    check('agent signs in (email case-insensitive)', agent.success, true);
    check('agent role returned', agent.user.role, 'agent');
    check('wrong password rejected', (await login(env, 'ain@example.com', 'nope nope nope')).status, 401);
    check('inactive user rejected', (await login(env, 'bee@example.com')).status, 401);
    check('user without password rejected', (await login(env, 'newbie@example.com', '')).status, 401);
    check('unknown email rejected', (await login(env, 'who@example.com')).status, 401);
    const owner = await loginAs('admin', PASSWORD);
    check('owner still signs in', owner.user.role, 'owner');
  }

  console.log('=== agent sees only own clients ===');
  {
    const { token } = await loginAs('ain@example.com');
    const list = await (await worker.fetch(req('/admin/submissions', { token }), env)).json();
    check('list scoped to agent', list.submissions.map((s) => s.fullName), ['Client of Ain']);
    ok('list asks Airtable to filter by agent email', airtableCalls.some((c) => (new URL(c.url).searchParams.get('filterByFormula') || '').includes("{Agent Email})) = 'ain@example.com'")));
    check('own client detail -> 200', (await worker.fetch(req('/admin/submissions/recCLIENTA0000001', { token }), env)).status, 200);
    check("other client's detail -> 404", (await worker.fetch(req('/admin/submissions/recCLIENTO0000001', { token }), env)).status, 404);
    const patchOther = await worker.fetch(req('/admin/submissions/recCLIENTO0000001', { method: 'PATCH', token, body: { status: 'Approved' } }), env);
    check("other client's status -> 404", patchOther.status, 404);
    check('other client untouched', clients[1].fields['Submission Status'], undefined);
    const patchOwn = await worker.fetch(req('/admin/submissions/recCLIENTA0000001', { method: 'PATCH', token, body: { status: 'In Review' } }), env);
    check('own client status -> 200', patchOwn.status, 200);
    check('team page forbidden for agent', (await worker.fetch(req('/admin/team', { token }), env)).status, 403);

    users[1].fields.Active = false;
    check('deactivating ends the session', (await worker.fetch(req('/admin/submissions', { token }), env)).status, 401);
    users[1].fields.Active = true;
  }

  console.log('=== leader sees everyone ===');
  {
    const { token } = await loginAs('rose@example.com');
    const list = await (await worker.fetch(req('/admin/submissions', { token }), env)).json();
    check('leader list unscoped', list.submissions.length, 2);
    check('leader opens any client', (await worker.fetch(req('/admin/submissions/recCLIENTO0000001', { token }), env)).status, 200);
    check('team page forbidden for leader', (await worker.fetch(req('/admin/team', { token }), env)).status, 403);
  }

  console.log('=== team management + setup codes ===');
  {
    const { token } = await loginAs('admin', PASSWORD);
    const team = await (await worker.fetch(req('/admin/team', { token }), env)).json();
    check('owner lists team', team.users.length, 4);
    ok('hashes never returned', !JSON.stringify(team).includes('pbkdf2'));

    const add = await worker.fetch(req('/admin/team', { method: 'POST', token, body: { name: 'Ain Two', email: 'ain2@example.com', role: 'agent' } }), env);
    check('add member -> 201', add.status, 201);
    check('form code made unique', (await add.json()).user.formCode, 'ain2');
    const dup = await worker.fetch(req('/admin/team', { method: 'POST', token, body: { name: 'X', email: 'AIN@example.com', role: 'agent' } }), env);
    check('duplicate email -> 409', dup.status, 409);

    const codeRes = await (await worker.fetch(req('/admin/team/recNEWBIE00000001/setup-code', { method: 'POST', token }), env)).json();
    ok('setup code format', /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(codeRes.code));
    ok('code stored only as a hash', users[3].fields['Setup Code Hash'] && !users[3].fields['Setup Code Hash'].includes(codeRes.code.replace('-', '')));

    const setPw = (body) => worker.fetch(req('/admin/set-password', { method: 'POST', body }), env);
    check('wrong code -> 401', (await setPw({ username: 'newbie@example.com', code: 'AAAAA-AAAAA', password: 'pw8chars' })).status, 401);
    check('short password -> 400', (await setPw({ username: 'newbie@example.com', code: codeRes.code, password: 'short' })).status, 400);
    const otpLogin = await login(env, 'newbie@example.com', codeRes.code);
    check('signing in with the one-time password asks for a new one', otpLogin.status, 403);
    check('reset-required code', (await otpLogin.json()).code, 'password_change_required');
    const done = await setPw({ username: 'NewBie@example.com', code: codeRes.code.toLowerCase().replace('-', ' '), password: 'pw8chars' });
    check('valid code sets password', done.status, 200);
    ok('signed in straight away', (await done.json()).token);
    check('code is single-use', (await setPw({ username: 'newbie@example.com', code: codeRes.code, password: 'another8' })).status, 401);
    check('new password works', (await login(env, 'newbie@example.com', 'pw8chars')).status, 200);

    users[3].fields['Setup Code Hash'] = 'x';
    users[3].fields['Setup Code Expires'] = '2000-01-01T00:00:00.000Z';
    const fresh = await (await worker.fetch(req('/admin/team/recNEWBIE00000001/setup-code', { method: 'POST', token }), env)).json();
    users[3].fields['Setup Code Expires'] = '2000-01-01T00:00:00.000Z';
    check('expired code -> 401', (await setPw({ username: 'newbie@example.com', code: fresh.code, password: 'pw8chars' })).status, 401);

    const off = await worker.fetch(req('/admin/team/recAGENTA00000001', { method: 'PATCH', token, body: { active: false } }), env);
    check('owner deactivates', (await off.json()).user.active, false);
    users[1].fields.Active = true;
  }

  console.log('=== agent form link tags the submission ===');
  {
    const created = fakeAirtable({ users, clients });
    const payload = { version: '1.2', metadata: { submissionId: 'sub-1' }, applicant: { fullName: 'Tagged Client' }, beneficiaries: [], agentCode: 'ain' };
    const res = await worker.fetch(new Request('https://worker.example/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), env);
    check('submit 200', res.status, 200);
    const rec = created.find((c) => c.table === 'tblFAKE').rec;
    check('agent email tagged', rec.fields['Agent Email'], 'ain@example.com');
    check('agent name tagged', rec.fields['Agent Name'], 'Ain Agent');

    const created2 = fakeAirtable({ users, clients });
    const res2 = await worker.fetch(new Request('https://worker.example/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, agentCode: 'nobody' }) }), env);
    check('unknown code still submits', res2.status, 200);
    check('unknown code leaves it untagged', created2.find((c) => c.table === 'tblFAKE').rec.fields['Agent Email'], undefined);
  }
}

run();
