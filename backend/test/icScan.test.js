/**
 * icScan.test.js
 *
 * POST /scan-ic through the Worker's fetch handler, with global.fetch
 * mocked so nothing reaches the real Claude API.
 *
 * Usage: node test/icScan.test.js
 */

import assert from 'node:assert';
import worker from '../src/worker.js';
import { normalizeNric, toFormFields, SCAN_MODEL } from '../src/icScan.js';

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
const ENV = { ANTHROPIC_API_KEY: 'test-key' };
const IMAGE = { base64: 'aGVsbG8=', mimeType: 'image/jpeg' };

function scanRequest(body, { origin = ORIGIN, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  return new Request('https://worker.example/scan-ic', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
}

function claudeReply(read, { stopReason = 'end_turn' } = {}) {
  return new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: SCAN_MODEL,
    content: stopReason === 'refusal' ? [] : [{ type: 'text', text: JSON.stringify(read) }],
    stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 80 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const GOOD_READ = {
  isMyKad: true, readable: true, nric: '900101 01 1235', fullName: 'Ahmad  bin Test',
  address: 'NO 12, JALAN MAWAR, 08000 SUNGAI PETANI, KEDAH', gender: 'PEREMPUAN', religion: 'ISLAM', problem: '',
};

async function run() {
  const originalFetch = global.fetch;
  let sent = null;
  const mockClaude = (responder) => {
    global.fetch = async (url, init) => {
      sent = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return responder();
    };
  };

  console.log('=== helpers ===');
  check('normalizeNric formats 12 digits', normalizeNric('900101011234'), '900101-01-1234');
  check('normalizeNric rejects wrong length', normalizeNric('90010101123'), '');
  check('IC last digit decides gender over the printed word', toFormFields(GOOD_READ).gender, 'Male');
  check('printed gender used when IC number unreadable', toFormFields({ ...GOOD_READ, nric: '' }).gender, 'Female');
  check('religion only when ISLAM is printed', [toFormFields(GOOD_READ).religion, toFormFields({ ...GOOD_READ, religion: '' }).religion], ['Islam', '']);
  check('name whitespace tidied, kept in capitals', toFormFields(GOOD_READ).fullName, 'AHMAD BIN TEST');

  console.log('\n=== guards ===');
  {
    const res = await worker.fetch(scanRequest({ image: IMAGE }), {});
    check('no API key -> 503 scan_unavailable', [res.status, (await res.json()).code], [503, 'scan_unavailable']);
  }
  {
    const res = await worker.fetch(scanRequest({ image: IMAGE }, { origin: 'https://evil.example' }), ENV);
    check('other website -> 403', res.status, 403);
  }
  {
    const res = await worker.fetch(scanRequest(null, { method: 'OPTIONS' }), ENV);
    check('preflight allows only the form site', [res.status, res.headers.get('Access-Control-Allow-Origin')], [204, ORIGIN]);
  }
  {
    const res = await worker.fetch(scanRequest({ image: { base64: 'x', mimeType: 'application/pdf' } }), ENV);
    check('PDF / unsupported type -> 400 invalid_image', [res.status, (await res.json()).code], [400, 'invalid_image']);
  }
  {
    const limited = { ...ENV, SCAN_RATE_LIMITER: { limit: async () => ({ success: false }) } };
    const res = await worker.fetch(scanRequest({ image: IMAGE }), limited);
    check('rate limited -> 429', res.status, 429);
  }

  console.log('\n=== reading a card ===');
  {
    mockClaude(() => claudeReply(GOOD_READ));
    const res = await worker.fetch(scanRequest({ image: IMAGE }), ENV);
    const body = await res.json();
    check('success returns the form fields', [res.status, body.fields], [200, {
      nric: '900101-01-1235', fullName: 'AHMAD BIN TEST', address: 'NO 12, JALAN MAWAR, 08000 SUNGAI PETANI, KEDAH', gender: 'Male', religion: 'Islam',
    }]);
    check('nothing reported missing', body.missing, []);
    check('calls the Messages API with the configured model', [new URL(sent.url).pathname === '/v1/messages', sent.body.model], [true, SCAN_MODEL]);
    check('sends the photo as a base64 image', sent.body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: IMAGE.base64 } });
    check('asks for schema-shaped JSON', sent.body.output_config.format.type, 'json_schema');
    check('server-side fallback enabled', [sent.body.fallbacks, (sent.headers.get('anthropic-beta') || '').includes('server-side-fallback-2026-07-01')], ['default', true]);
    check('API key sent as x-api-key', sent.headers.get('x-api-key'), 'test-key');
    check('CORS on the answer is the form site', res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  }
  {
    mockClaude(() => claudeReply({ ...GOOD_READ, nric: '', address: '', readable: false, problem: 'Glare covers the lower half.' }));
    const body = await (await worker.fetch(scanRequest({ image: IMAGE }), ENV)).json();
    check('unreadable parts are listed, with the note', [body.missing, body.readable, body.note], [['IC number', 'address'], false, 'Glare covers the lower half.']);
  }
  {
    mockClaude(() => claudeReply({ ...GOOD_READ, isMyKad: false }));
    const res = await worker.fetch(scanRequest({ image: IMAGE }), ENV);
    check('not a MyKad -> 422 not_mykad', [res.status, (await res.json()).code], [422, 'not_mykad']);
  }
  {
    mockClaude(() => claudeReply(null, { stopReason: 'refusal' }));
    const res = await worker.fetch(scanRequest({ image: IMAGE }), ENV);
    check('refusal -> 422 unreadable', [res.status, (await res.json()).code], [422, 'unreadable']);
  }
  {
    mockClaude(() => new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'internal detail' } }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    const res = await worker.fetch(scanRequest({ image: IMAGE }), ENV);
    const body = await res.json();
    check('upstream failure -> 502 without leaking upstream text', [res.status, body.code, body.error.includes('internal detail')], [502, 'scan_failed', false]);
  }

  global.fetch = originalFetch;
  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail) process.exit(1);
}

run();
