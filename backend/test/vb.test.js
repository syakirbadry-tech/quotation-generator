/**
 * vb.test.js
 *
 * /admin/vb through the Worker's fetch handler, with a real SQL database
 * (Node's SQLite behind a D1-shaped wrapper) and Airtable mocked for the
 * Dashboard Users lookups that identify agents and leaders.
 *
 * Usage: node test/vb.test.js
 */

import assert from 'node:assert';
import worker from '../src/worker.js';
import { createSessionToken } from '../src/admin.js';
import { tpcOf, casesOf, weekRange } from '../src/vb.js';
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
  recAGENTA00000001: { Name: 'Ain Agent', Email: 'ain@example.com', Role: 'Agent', Active: true, 'Password Hash': 'x' },
  recAGENTB00000001: { Name: 'Bee Agent', Email: 'bee@example.com', Role: 'Agent', Active: true, 'Password Hash': 'x' },
  recLEADER00000001: { Name: 'Rose Leader', Email: 'rose@example.com', Role: 'Leader', Active: true, 'Password Hash': 'x' },
};

const env = {
  AIRTABLE_PAT: 'fake-pat', AIRTABLE_BASE_ID: 'appFAKE', AIRTABLE_TABLE_ID: 'tblFAKE', AIRTABLE_USERS_TABLE_ID: 'tblUSERS',
  ADMIN_ALLOWED_ORIGIN: ORIGIN, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: 'unused', ADMIN_SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  QUOTATIONS_DB: createSqliteD1(),
};

global.fetch = async (url) => {
  const id = new URL(String(url)).pathname.split('/').pop();
  const fields = USERS[id];
  return new Response(JSON.stringify(fields ? { id, createdTime: '2026-01-01T00:00:00.000Z', fields } : { error: 'NOT_FOUND' }), { status: fields ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
};

const tokenFor = async (uid) => (await createSessionToken(env, USERS[uid].Email, undefined, { kind: 'user', uid })).token;
async function call(token, path, method = 'GET', body) {
  const headers = { Authorization: `Bearer ${token}`, Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request(`https://worker.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json(), cors: res.headers.get('Access-Control-Allow-Origin') };
}

async function run() {
  console.log('=== helpers ===');
  check('TPC: RM100 monthly = 1,200', tpcOf(100, 'Monthly'), 1200);
  check('TPC: RM500 quarterly = 2,000', tpcOf(500, 'Quarterly'), 2000);
  check('TPC 1,800 counts as 1 case, below as 0.5', [casesOf(1800), casesOf(1799.99), casesOf(1200)], [1, 0.5, 0.5]);
  check('week starts Monday 00:00 Malaysia time', weekRange(new Date('2026-10-18T10:00:00Z')), { start: '2026-10-11T16:00:00.000Z', end: '2026-10-18T16:00:00.000Z' });
  check('Sunday night MY time is still the same week', weekRange(new Date('2026-10-18T15:59:00Z')).start, '2026-10-11T16:00:00.000Z');

  const ain = await tokenFor('recAGENTA00000001');
  const bee = await tokenFor('recAGENTB00000001');
  const rose = await tokenFor('recLEADER00000001');
  const owner = (await createSessionToken(env, 'admin')).token;

  console.log('\n=== agent pipeline ===');
  {
    const res = await call(ain, '/admin/vb', 'POST', { name: '  Hafiz   bin Kamal ', phone: '012-345 6789', source: 'Referral', note: 'Met at kenduri\nCall after 6pm' });
    check('add a name -> 201 at VB1', [res.status, res.body.prospect.stage, res.body.prospect.name], [201, 1, 'Hafiz bin Kamal']);
    check('note keeps its line break', res.body.prospect.note, 'Met at kenduri\nCall after 6pm');
    check('CORS for the dashboard site', res.cors, ORIGIN);
    const id = res.body.prospect.id;

    check('name is required', (await call(ain, '/admin/vb', 'POST', { name: '   ' })).status, 400);
    check('contacted -> VB2', (await call(ain, `/admin/vb/${id}`, 'PATCH', { action: 'contacted' })).body.prospect.stage, 2);
    check('bad appointment time rejected', (await call(ain, `/admin/vb/${id}`, 'PATCH', { action: 'appointment', at: 'tomorrow' })).status, 400);
    const meeting = new Date(Date.now() + 30 * 86400000).toISOString(); // well after this week
    const appt = await call(ain, `/admin/vb/${id}`, 'PATCH', { action: 'appointment', at: meeting });
    check('appointment -> VB3 with time', [appt.body.prospect.stage, appt.body.prospect.appointmentAt], [3, meeting]);
    check('approval needs a frequency', (await call(ain, `/admin/vb/${id}`, 'PATCH', { action: 'approved', product: 'PRUBSN Protect', premium: 100 })).status, 400);
    const appr = await call(ain, `/admin/vb/${id}`, 'PATCH', { action: 'approved', product: 'PRUBSN Protect', premium: 100, frequency: 'Monthly' });
    check('approved -> VB4, TPC 1,200 = 0.5 case', [appr.body.prospect.stage, appr.body.prospect.tpc, appr.body.prospect.cases], [4, 1200, 0.5]);
    check('a later "contacted" never moves a name back', (await call(ain, `/admin/vb/${id}`, 'PATCH', { action: 'contacted' })).body.prospect.stage, 4);
    check('unknown action rejected', (await call(ain, `/admin/vb/${id}`, 'PATCH', { action: 'teleport' })).status, 400);

    const second = (await call(ain, '/admin/vb', 'POST', { name: 'Siti Aminah' })).body.prospect.id;
    await call(ain, `/admin/vb/${second}`, 'PATCH', { action: 'approved', product: 'PRUBSN Medic', premium: 1800, frequency: 'Yearly' });

    const list = await call(ain, '/admin/vb');
    check('agent sees their own names', list.body.prospects.map((p) => p.name).sort(), ['Hafiz bin Kamal', 'Siti Aminah']);
    check('agent gets no team block', list.body.team, null);
    check('week counts: cases 1.5, TPC 3,000', [list.body.week.counts.vb1, list.body.week.counts.vb4, list.body.week.counts.cases, list.body.week.counts.tpc], [2, 2, 1.5, 3000]);

    console.log('\n=== privacy ===');
    const other = await call(bee, '/admin/vb');
    check("another agent sees none of Ain's names", other.body.prospects, []);
    check("another agent cannot open Ain's name", (await call(bee, `/admin/vb/${id}`, 'PATCH', { action: 'contacted' })).status, 404);
    check("another agent cannot delete Ain's name", (await call(bee, `/admin/vb/${id}`, 'DELETE')).status, 404);

    const lead = await call(rose, '/admin/vb');
    check('leader sees no prospect names of others', lead.body.prospects, []);
    const ainRow = lead.body.team.find((t) => t.agent === 'Ain Agent');
    check('leader sees Ain by counts only (VB3 counts in the week the meeting is on)', ainRow, { agent: 'Ain Agent', byStage: { vb1: 0, vb2: 0, vb3: 0, vb4: 2 }, week: { vb1: 2, vb2: 2, vb3: 0, vb4: 2, cases: 1.5, tpc: 3000 } });
    check('team block never carries names or phones', JSON.stringify(lead.body.team).includes('Hafiz'), false);
    check('owner also gets the team counts', Array.isArray((await call(owner, '/admin/vb')).body.team), true);

    console.log('\n=== edit & delete ===');
    check('edit name', (await call(ain, `/admin/vb/${second}`, 'PATCH', { action: 'edit', name: 'Siti Aminah binti Ali' })).body.prospect.name, 'Siti Aminah binti Ali');
    check('delete own name', (await call(ain, `/admin/vb/${second}`, 'DELETE')).status, 200);
    check('deleted name is gone', (await call(ain, '/admin/vb')).body.prospects.length, 1);
    check('malformed id -> 404', (await call(ain, '/admin/vb/not-an-id', 'PATCH', { action: 'contacted' })).status, 404);
  }

  console.log('\n=== guards ===');
  check('signed-out -> 401', (await call('nope', '/admin/vb')).status, 401);
  {
    const res = await worker.fetch(new Request('https://worker.example/admin/vb', { headers: { Authorization: `Bearer ${owner}` } }), { ...env, QUOTATIONS_DB: undefined });
    check('no database -> 503 not_configured', [res.status, (await res.json()).code], [503, 'not_configured']);
  }
  {
    const pre = await worker.fetch(new Request('https://worker.example/admin/vb/x', { method: 'OPTIONS' }), env);
    check('preflight allows DELETE', pre.headers.get('Access-Control-Allow-Methods').includes('DELETE'), true);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail) process.exit(1);
}

run();
