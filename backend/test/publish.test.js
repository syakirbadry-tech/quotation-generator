/**
 * publish.test.js
 *
 * Unit tests for backend/src/publish.js - the Phase 9 public quotation
 * storage layer. Uses fakeD1.js in place of a real D1 binding (see that
 * file's header comment for why).
 *
 * Usage: node test/publish.test.js
 */

import assert from 'node:assert';
import { slugify, validatePublishPayload, insertQuotation, getQuotationById, notFoundHtml, MAX_PUBLISH_PAYLOAD_BYTES } from '../src/publish.js';
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

console.log('=== slugify ===');
{
  check('lowercases and hyphenates', slugify('Santun Syafitri Binti Mulyadi'), 'santun-syafitri-binti-mulyadi');
  check('strips accents', slugify('José Ñoño'), 'jose-nono');
  check('collapses repeated separators', slugify("O'Brien  --  Smith"), 'o-brien-smith');
  check('trims leading/trailing hyphens', slugify('  -Test-  '), 'test');
  check('empty/missing name falls back to a safe default, never an empty path segment', slugify(''), 'client');
  check('null name falls back to a safe default', slugify(null), 'client');
  check('very long name is capped, not left unbounded', slugify('a'.repeat(500)).length <= 80, true);
}

console.log('\n=== validatePublishPayload ===');
{
  const validHtml = '<div id="pq-doc">hi</div>';
  const base = { clientName: 'Test Client', generatedHtml: validHtml, quotationJson: { client: {} }, rendererVersion: 'narrative-v1' };

  check('a well-formed payload passes', validatePublishPayload(base), null);
  ok('missing clientName is rejected', validatePublishPayload({ ...base, clientName: undefined }));
  ok('missing generatedHtml is rejected', validatePublishPayload({ ...base, generatedHtml: undefined }));
  ok('generatedHtml missing the pq-doc marker is rejected (not this renderer\'s own output)', validatePublishPayload({ ...base, generatedHtml: '<div>not a quotation</div>' }));
  ok('missing quotationJson is rejected', validatePublishPayload({ ...base, quotationJson: undefined }));
  ok('quotationJson as an array is rejected (must be an object)', validatePublishPayload({ ...base, quotationJson: [] }));
  ok('missing rendererVersion is rejected', validatePublishPayload({ ...base, rendererVersion: undefined }));
  ok('oversized generatedHtml is rejected', validatePublishPayload({ ...base, generatedHtml: '<div id="pq-doc">' + 'x'.repeat(MAX_PUBLISH_PAYLOAD_BYTES + 1) + '</div>' }));
}

console.log('\n=== insertQuotation / getQuotationById (fakeD1) ===');
{
  const db = createFakeD1();
  const record = {
    slug: 'test-client',
    clientName: 'Test Client',
    plan: 'PruBSN AnugerahMax',
    monthlyTotalPayable: 'RM 176.00',
    annualContribution: 'RM 2,112',
    rendererVersion: 'narrative-v1',
    quotationJson: { client: { fullName: 'Test Client' } },
    generatedHtml: '<div id="pq-doc">hello</div>',
  };

  const { id, uniqueId, generatedDate } = await insertQuotation(db, record);
  ok('id is "{slug}-{uniqueId}"', id === `test-client-${uniqueId}`);
  ok('uniqueId looks like 8 lowercase hex chars', /^[0-9a-f]{8}$/.test(uniqueId));
  ok('generatedDate is a valid ISO string', !Number.isNaN(Date.parse(generatedDate)));

  const row = await getQuotationById(db, id);
  ok('stored row is found by id', Boolean(row));
  check('client_name round-trips', row.client_name, 'Test Client');
  check('generated_html round-trips byte-for-byte', row.generated_html, record.generatedHtml);
  check('quotation_json round-trips as valid JSON', JSON.parse(row.quotation_json), record.quotationJson);
  check('application_status defaults to "Not Started"', row.application_status, 'Not Started');

  const missing = await getQuotationById(db, 'does-not-exist-00000000');
  check('a non-existent id resolves to null, not an error', missing, null);
}

console.log('\n=== insertQuotation retries on a genuine unique_id collision ===');
{
  const db = createFakeD1();
  db._forceCollisionOnce();
  const record = {
    slug: 'retry-client',
    clientName: 'Retry Client',
    rendererVersion: 'narrative-v1',
    quotationJson: {},
    generatedHtml: '<div id="pq-doc">hi</div>',
  };
  const { id } = await insertQuotation(db, record);
  ok('a collision on the first attempt still succeeds on retry', Boolean(id));
}

console.log('\n=== notFoundHtml ===');
{
  const page = notFoundHtml();
  ok('is a real HTML document', page.includes('<title>'));
  ok('never leaks any internal detail (query, stack, etc.)', !/quotation_json|D1|SELECT|stack/i.test(page));
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
