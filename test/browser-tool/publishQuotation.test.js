/**
 * publishQuotation.test.js
 *
 * Unit tests for browser-tool/publishQuotation.js - the one place the
 * agent tool makes a network request (Phase 9 publishing). global.fetch
 * mocked throughout; nothing here ever reaches a real Worker.
 *
 * Usage: node test/browser-tool/publishQuotation.test.js
 */

'use strict';

const assert = require('assert');
const { publishQuotation, buildPublishPayload, PUBLISH_ENDPOINT } = require('../../browser-tool/publishQuotation.js');

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

const sampleData = {
  metadata: { productName: 'PruBSN AnugerahMax' },
  client: { fullName: 'Santun Syafitri Binti Mulyadi' },
  contributions: { totalMonthlyContribution: 176, totalAnnualContribution: 2112 },
};

async function run() {
  const originalFetch = global.fetch;

  console.log('=== buildPublishPayload ===');
  {
    const payload = buildPublishPayload(sampleData, '<div id="pq-doc">x</div>', 'narrative-v1');
    check('clientName', payload.clientName, 'Santun Syafitri Binti Mulyadi');
    check('plan', payload.plan, 'PruBSN AnugerahMax');
    check('monthlyTotalPayable is fixed-2dp, matching the standardization rule', payload.monthlyTotalPayable, 'RM 176.00');
    check('annualContribution', payload.annualContribution, 'RM 2,112');
    check('rendererVersion', payload.rendererVersion, 'narrative-v1');
    check('quotationJson is the original data object, unmodified', payload.quotationJson, sampleData);
    check('generatedHtml passes through unchanged', payload.generatedHtml, '<div id="pq-doc">x</div>');

    const missingName = buildPublishPayload({}, '<div id="pq-doc"></div>', 'narrative-v1');
    check('a missing client name falls back to a safe default, never undefined/null in the payload', missingName.clientName, 'Client');
    check('missing contribution data resolves to null, not NaN/undefined', missingName.monthlyTotalPayable, null);
  }

  console.log('\n=== publishQuotation: success ===');
  {
    let capturedUrl, capturedBody;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ success: true, id: 'santun-syafitri-binti-mulyadi-8f93cbe2', url: 'https://worker.example/q/santun-syafitri-binti-mulyadi-8f93cbe2' }) };
    };
    const result = await publishQuotation(sampleData, '<div id="pq-doc">x</div>', 'narrative-v1');
    check('result status is success', result.status, 'success');
    check('result carries the returned url', result.url, 'https://worker.example/q/santun-syafitri-binti-mulyadi-8f93cbe2');
    check('result carries the returned id', result.id, 'santun-syafitri-binti-mulyadi-8f93cbe2');
    check('POSTed to the configured publish endpoint', capturedUrl, PUBLISH_ENDPOINT);
    check('request body is the built payload', capturedBody.clientName, 'Santun Syafitri Binti Mulyadi');
    global.fetch = originalFetch;
  }

  console.log('\n=== publishQuotation: backend returns success:false ===');
  {
    global.fetch = async () => ({ ok: true, json: async () => ({ success: false, error: 'generatedHtml does not look like a quotation this renderer produced.', code: 'invalid_payload' }) });
    const result = await publishQuotation(sampleData, '<div id="pq-doc">x</div>', 'narrative-v1');
    check('result status is failed', result.status, 'failed');
    check('error message is surfaced from the backend', result.error, 'generatedHtml does not look like a quotation this renderer produced.');
    global.fetch = originalFetch;
  }

  console.log('\n=== publishQuotation: HTTP error with no parseable JSON body ===');
  {
    global.fetch = async () => ({ ok: false, json: async () => { throw new Error('not json'); } });
    const result = await publishQuotation(sampleData, '<div id="pq-doc">x</div>', 'narrative-v1');
    check('result status is failed', result.status, 'failed');
    ok('a reasonable error message is still produced, not a thrown exception', typeof result.error === 'string' && result.error.length > 0);
    global.fetch = originalFetch;
  }

  console.log('\n=== publishQuotation: network failure (fetch itself rejects) ===');
  {
    global.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const result = await publishQuotation(sampleData, '<div id="pq-doc">x</div>', 'narrative-v1');
    check('result status is failed', result.status, 'failed');
    ok('error message is human-readable, not a raw exception', result.error.includes('reach'));
    global.fetch = originalFetch;
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
