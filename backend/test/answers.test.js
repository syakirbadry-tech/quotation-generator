/**
 * answers.test.js
 *
 * POST /presentation-answers and /admin/presentation-answers through the
 * Worker's fetch handler, with a real SQL database (sqliteD1.js) and
 * Airtable mocked for the Dashboard Users lookups.
 *
 * Usage: node --no-warnings test/answers.test.js
 */

import assert from 'node:assert';
import worker from '../src/worker.js';
import { createSessionToken } from '../src/admin.js';
import { validateAnswers } from '../src/answers.js';
import { createSqliteD1 } from './sqliteD1.js';

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

const ORIGIN = 'https://syakirbadry-tech.github.io';
const USERS = {
  recAGENTA00000001: { Name: 'Ain Agent', Email: 'ain@example.com', Role: 'Agent', Active: true, 'Password Hash': 'x', 'Form Code': 'ain' },
  recAGENTB00000001: { Name: 'Bee Agent', Email: 'bee@example.com', Role: 'Agent', Active: true, 'Password Hash': 'x', 'Form Code': 'bee' },
};

const env = {
  AIRTABLE_PAT: 'fake-pat', AIRTABLE_BASE_ID: 'appFAKE', AIRTABLE_TABLE_ID: 'tblFAKE', AIRTABLE_USERS_TABLE_ID: 'tblUSERS',
  ADMIN_ALLOWED_ORIGIN: ORIGIN, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: 'unused', ADMIN_SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  ALLOWED_ORIGIN: '*',
  QUOTATIONS_DB: createSqliteD1(),
};

// Airtable mock: record fetch by id, or a filterByFormula lookup by Form Code.
global.fetch = async (url) => {
  const u = new URL(String(url));
  const formula = u.searchParams.get('filterByFormula') || '';
  let body;
  if (formula) {
    const records = Object.entries(USERS).filter(([, f]) => formula.includes(`"${f['Form Code']}"`) || formula.includes(`'${f['Form Code']}'`)).map(([id, fields]) => ({ id, createdTime: '2026-01-01T00:00:00.000Z', fields }));
    body = { records };
  } else {
    const id = u.pathname.split('/').pop();
    const fields = USERS[id];
    if (!fields) return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    body = { id, createdTime: '2026-01-01T00:00:00.000Z', fields };
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const ownerToken = async () => (await createSessionToken(env, 'admin')).token;
const agentToken = async (uid) => (await createSessionToken(env, USERS[uid].Email, undefined, { kind: 'user', uid })).token;

async function send(body, type = 'application/json') {
  const res = await worker.fetch(new Request('https://worker.example/presentation-answers', { method: 'POST', headers: { 'Content-Type': type, Origin: 'https://syakirbadry-tech.github.io' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json(), cors: res.headers.get('Access-Control-Allow-Origin') };
}
async function admin(token, path, method = 'GET') {
  const res = await worker.fetch(new Request(`https://worker.example${path}`, { method, headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN } }), env);
  return { status: res.status, body: await res.json() };
}

const good = {
  client: 'Muhammad Syafiq Bin Zainudin',
  source: 'AnugerahMax presentation',
  answers: { ex: ['Medical card', 'Life cover'], mcLimit: '100000', pri: ['Cancer'], bud: 'RM200-300', opt: 'Option 2 · RM318' },
  summary: ['Protection today: Medical card, Life cover', 'Preferred option: Option 2 · RM318'],
};

async function run() {
  console.log('=== validation ===');
  check('good payload passes', Boolean(validateAnswers(good).value), true);
  check('missing client', validateAnswers({ ...good, client: '' }).error, 'client must be a name of 1-100 characters.');
  check('answers must be object', validateAnswers({ ...good, answers: [] }).error, 'answers must be an object.');
  check('bad key refused', validateAnswers({ ...good, answers: { 'a b': 'x' } }).error, 'answers has an invalid key: a b');
  check('IC number refused', /IC, bank or card/.test(validateAnswers({ ...good, answers: { note: 'my ic 900101-14-5678' } }).error), true);
  check('IC in summary refused', /IC, bank or card/.test(validateAnswers({ ...good, summary: ['IC 900101145678'] }).error), true);
  check('bank number refused', /IC, bank or card/.test(validateAnswers({ ...good, answers: { x: '1234 5678 9012' } }).error), true);
  check('RM1,000,000 limit is fine', Boolean(validateAnswers({ ...good, answers: { mcLimit: '1000000' } }).value), true);
  check('too many items', validateAnswers({ ...good, answers: { ex: Array(13).fill('a') } }).error, 'answers.ex has too many items.');
  check('empty values dropped -> empty', validateAnswers({ ...good, answers: { ex: [], bud: '' } }).error, 'answers is empty.');

  console.log('=== POST /presentation-answers ===');
  let r = await send(good);
  check('saves (200)', [r.status, r.body.success], [200, true]);
  check('public CORS', r.cors, '*');
  r = await send(good, 'text/plain');
  check('text/plain accepted', r.status, 200);
  r = await send({ ...good, client: 'Agent Client', agentCode: 'ain', vbId: '11111111-2222-3333-4444-555555555555' });
  check('with agent code (200)', r.status, 200);
  const sid = '9a8b7c6d-1111-4222-8333-944455556666';
  r = await send({ ...good, client: 'Auto Client', sendId: sid, answers: { pri: ['Cancer'] }, summary: ['Biggest worries: Cancer'] });
  check('auto-save creates its row with the sendId', [r.status, r.body.id, r.body.updated], [200, sid, undefined]);
  r = await send({ ...good, client: 'Auto Client', sendId: sid, answers: { pri: ['Cancer'], bud: 'RM200-300' }, summary: ['Biggest worries: Cancer', 'Monthly budget: RM200-300'] });
  check('next auto-save updates the same row', [r.status, r.body.id, r.body.updated], [200, sid, true]);
  r = await send({ ...good, client: 'Someone Else', sendId: sid });
  check('another client cannot overwrite that row', [r.status, r.body.code], [409, 'stale_send']);
  const rows = await env.QUOTATIONS_DB.prepare('SELECT summary_json FROM presentation_answers WHERE id = ?').bind(sid).all();
  check('one row holds the latest answers', rows.results.map((x) => JSON.parse(x.summary_json).length), [2]);
  await env.QUOTATIONS_DB.prepare('DELETE FROM presentation_answers WHERE id = ?').bind(sid).run();
  r = await send('{nope');
  check('bad JSON 400', [r.status, r.body.code], [400, 'invalid_json']);
  r = await send({ ...good, answers: { note: '900101-14-5678' } });
  check('IC refused 400', [r.status, r.body.code], [400, 'invalid_payload']);
  r = await send('x'.repeat(9000));
  check('oversize 413', r.status, 413);
  const get = await worker.fetch(new Request('https://worker.example/presentation-answers'), env);
  check('GET is 405', get.status, 405);
  const pre = await worker.fetch(new Request('https://worker.example/presentation-answers', { method: 'OPTIONS' }), env);
  check('preflight 204', pre.status, 204);

  console.log('=== /admin/presentation-answers ===');
  r = await admin('bad-token', '/admin/presentation-answers');
  check('no session 401', r.status, 401);
  const owner = await ownerToken();
  r = await admin(owner, '/admin/presentation-answers');
  check('owner sees all 3', [r.status, r.body.answers.length], [200, 3]);
  check('newest first, tagged with agent', [r.body.answers[0].client, r.body.answers[0].agentName, r.body.answers[0].agentEmail], ['Agent Client', 'Ain Agent', 'ain@example.com']);
  check('tagged with the VB prospect', [r.body.answers[0].vbId, r.body.answers[1].vbId], ['11111111-2222-3333-4444-555555555555', null]);
  check('a malformed vbId is dropped', validateAnswers({ ...good, vbId: "x' OR 1=1" }).value.vbId, '');
  const untagged = r.body.answers[2];
  check('answers round-trip', untagged.answers, good.answers);
  check('summary round-trip', untagged.summary, good.summary);

  const ain = await agentToken('recAGENTA00000001');
  r = await admin(ain, '/admin/presentation-answers');
  check('agent sees only their own', r.body.answers.map((a) => a.client), ['Agent Client']);
  const bee = await agentToken('recAGENTB00000001');
  r = await admin(bee, '/admin/presentation-answers');
  check('other agent sees none', r.body.answers.length, 0);
  r = await admin(bee, `/admin/presentation-answers/${untagged.id}`, 'DELETE');
  check('agent cannot delete others', r.status, 404);
  r = await admin(owner, `/admin/presentation-answers/${untagged.id}`, 'DELETE');
  check('owner deletes', r.status, 200);
  r = await admin(owner, '/admin/presentation-answers');
  check('2 left', r.body.answers.length, 2);
  r = await admin(owner, '/admin/presentation-answers/not-an-id', 'DELETE');
  check('bad id 404', r.status, 404);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run().catch((err) => { console.error(err); process.exit(1); });
