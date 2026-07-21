/**
 * validate.test.js
 *
 * Usage: node test/validate.test.js
 */

import assert from 'node:assert';
import { validatePayloadShape, parseJsonBody, checkContentLength, MAX_PAYLOAD_BYTES } from '../src/validate.js';

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

const validPayload = {
  version: '1.2',
  metadata: { submissionId: 'sub-1' },
  applicant: { fullName: 'Test Client' },
  beneficiaries: [],
};

console.log('=== checkContentLength ===');
check('null content-length passes (checked again after reading body)', checkContentLength(null), null);
check('a small content-length passes', checkContentLength(1024), null);
ok('an oversized content-length is rejected', typeof checkContentLength(MAX_PAYLOAD_BYTES + 1) === 'string');

console.log('\n=== parseJsonBody ===');
check('valid JSON object parses', parseJsonBody(JSON.stringify(validPayload)), { payload: validPayload });
ok('malformed JSON is rejected', 'error' in parseJsonBody('{not json'));
ok('a JSON array (not an object) is rejected', 'error' in parseJsonBody('[1,2,3]'));
ok('a JSON primitive is rejected', 'error' in parseJsonBody('"just a string"'));
ok('an oversized body is rejected before JSON.parse is even attempted', 'error' in parseJsonBody('x'.repeat(MAX_PAYLOAD_BYTES + 1)));

console.log('\n=== validatePayloadShape ===');
check('a well-formed payload passes (returns null = no error)', validatePayloadShape(validPayload), null);
ok('missing version is rejected', typeof validatePayloadShape({ ...validPayload, version: undefined }) === 'string');
ok('missing metadata.submissionId is rejected', typeof validatePayloadShape({ ...validPayload, metadata: {} }) === 'string');
ok('missing applicant.fullName is rejected', typeof validatePayloadShape({ ...validPayload, applicant: {} }) === 'string');
ok('beneficiaries not being an array is rejected', typeof validatePayloadShape({ ...validPayload, beneficiaries: null }) === 'string');
ok(
  'a document missing base64 is rejected',
  typeof validatePayloadShape({ ...validPayload, documents: { nricFront: { filename: 'x.jpg' } } }) === 'string'
);
ok(
  'a well-formed document passes',
  validatePayloadShape({ ...validPayload, documents: { nricFront: { filename: 'x.jpg', mimeType: 'image/jpeg', base64: 'ZmFrZQ==' } } }) === null
);
ok(
  'an oversized document (base64) is rejected',
  typeof validatePayloadShape({ ...validPayload, documents: { nricFront: { base64: 'A'.repeat(9 * 1024 * 1024) } } }) === 'string'
);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
