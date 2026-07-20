/**
 * MockDestination.js
 *
 * CLIENT-RUNTIME destination adapter - a configurable stand-in for
 * exercising SubmissionService's success/failure/timeout/retry paths
 * without a real network call. Two uses:
 *   1. Tests (test/browser-tool/submissionPipeline.test.js).
 *   2. The safe default destination wired into clientRuntime.js until a
 *      real Airtable webhook URL is configured in AirtableDestination.js
 *      (see that file's header) - configured here to always succeed, so
 *      the shipped product behaves correctly today while the real
 *      Airtable wiring is completed as a follow-up.
 *
 * Same interface as every other destination: send(payload) -> Promise<{ reference }>.
 */

'use strict';

function createTypedError(type, message) {
  const err = new Error(message);
  err.type = type;
  return err;
}

/**
 * @param {object} [options]
 * @param {'success'|'failure'|'timeout'} [options.result='success']
 * @param {number} [options.latencyMs=0] artificial delay before resolving/rejecting
 * @param {string} [options.failureType='server'] error `.type` used when result === 'failure'
 * @param {string} [options.failureMessage] error message used when result === 'failure'
 */
function createMockDestination(options) {
  const opts = options || {};
  const result = opts.result || 'success';
  const latencyMs = opts.latencyMs || 0;
  const failureType = opts.failureType || 'server';
  const failureMessage = opts.failureMessage || 'Mock destination: simulated failure';

  function send(payload) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (result === 'success') {
          resolve({ reference: `MOCK-${Date.now().toString(36).toUpperCase()}` });
        } else if (result === 'timeout') {
          reject(createTypedError('timeout', 'Mock destination: simulated timeout'));
        } else {
          reject(createTypedError(failureType, failureMessage));
        }
      }, latencyMs);
    });
  }

  return { name: 'mock', send };
}

const MockDestination = { createMockDestination };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MockDestination;
}
