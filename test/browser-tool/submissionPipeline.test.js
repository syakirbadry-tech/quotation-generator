/**
 * submissionPipeline.test.js
 *
 * Unit tests for the Phase 5 submission pipeline: models/SubmissionPayload,
 * queue/SubmissionQueue, services/SubmissionService, and the destination
 * adapters. No PDF, no real client data, no network - MockDestination
 * drives success/failure/timeout, and AirtableDestination is exercised
 * against a mocked global.fetch, never a real endpoint.
 *
 * Usage: node test/browser-tool/submissionPipeline.test.js
 */

'use strict';

const assert = require('assert');
const { buildSubmissionPayload } = require('../../browser-tool/models/SubmissionPayload.js');
const { createQueue } = require('../../browser-tool/queue/SubmissionQueue.js');
const SubmissionService = require('../../browser-tool/services/SubmissionService.js');
const ConsoleDestination = require('../../browser-tool/destinations/ConsoleDestination.js');
const { createMockDestination } = require('../../browser-tool/destinations/MockDestination.js');
const AirtableDestination = require('../../browser-tool/destinations/AirtableDestination.js');

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

const fakePlans = [
  { planName: 'PruBSN Fake Plan', monthlyContribution: 'RM 123.45', roomAndBoard: 'RM 200 per day', annualLimit: 'RM 200,000' },
  { planName: 'PruBSN Fake Plan (Higher Tier)', monthlyContribution: 'RM 189.00', roomAndBoard: 'RM 300 per day', annualLimit: 'No Limit' },
];

const fakePrefillData = {
  quotation: { quotationNumber: 'Q-TEST-001', validUntil: '19 August 2026', validUntilIso: '2026-08-19', planName: 'PruBSN Fake Plan', monthlyContribution: 'RM 123.45', riders: ['Fake Rider - Plan 200'] },
  plans: fakePlans,
  agent: { name: 'Fake Agent', agency: 'Fake Agency', branch: 'Fake Branch', phone: '', email: '' },
  client: { fullName: 'Test Client', dateOfBirthIso: '1990-01-01', gender: 'Male' },
  metadata: { generatedAt: '2026-07-20T01:00:00.000Z' },
};

const fakeFormState = {
  fullName: 'Test Client', nric: '900101-01-1234', dateOfBirth: '1990-01-01', gender: 'Male',
  race: 'Malay', religion: 'Islam',
  mobileNumber: '012-3456789', email: 'test@example.com',
  address: '123 Jalan Test', postcode: '05100', city: 'Alor Setar', state: 'Kedah',
  occupation: 'Engineer', employer: 'Acme', annualIncome: '60000',
  plan: 'PruBSN Fake Plan (Higher Tier)',
  beneficiaryName: 'Jane Doe', beneficiaryRelationship: 'Spouse', beneficiaryPercentage: '100',
};

console.log('=== SubmissionPayload: shape + backward compatibility ===');
{
  const payload = buildSubmissionPayload(fakePrefillData, fakeFormState, {}, { submissionId: 'sub-1' });
  check('version is stamped', payload.version, '1.2');
  check('quotation is passed through unchanged from prefillData', payload.quotation, fakePrefillData.quotation);
  ok('applicant merges personal + address + employment fields', payload.applicant.fullName === 'Test Client' && payload.applicant.address === '123 Jalan Test' && payload.applicant.occupation === 'Engineer');
  check('applicant carries race and religion, collected on Step 1 but previously dropped before submission', { race: payload.applicant.race, religion: payload.applicant.religion }, { race: 'Malay', religion: 'Islam' });
  ok('applicant does not itself carry a nested beneficiary key', !('beneficiary' in payload.applicant));
  check('plansCompared carries every quotation the client was shown, verbatim', payload.plansCompared, fakePlans);
  check('selectedPlan is still the bare plan-name string (unchanged shape)', payload.selectedPlan, 'PruBSN Fake Plan (Higher Tier)');
  check('selectedPlanDetails resolves the choice back to its full price/room&board/annual-limit summary, even though it is NOT the primary (first) quotation', payload.selectedPlanDetails, fakePlans[1]);
  check('beneficiaries is an array wrapping the single Phase 4 beneficiary object, extended with the 7-step form\'s beneficiary NRIC', payload.beneficiaries, [{ name: 'Jane Doe', relationship: 'Spouse', percentage: '100', nric: '' }]);
  check('metadata.submissionId round-trips the id passed in', payload.metadata.submissionId, 'sub-1');
  check('metadata.quotationId comes from the quotation number', payload.metadata.quotationId, 'Q-TEST-001');
  check('metadata.generatedAt comes from buildPrefillData.js metadata', payload.metadata.generatedAt, '2026-07-20T01:00:00.000Z');
  ok('metadata.submittedAt is a fresh ISO timestamp', /^\d{4}-\d{2}-\d{2}T/.test(payload.metadata.submittedAt));
  ok('metadata carries parser/renderer version tags', typeof payload.metadata.parserVersion === 'string' && typeof payload.metadata.rendererVersion === 'string');

  console.log('\n=== SubmissionPayload: agent attribution (Phase 6A/8) ===');
  check('agent object carries name/agency/branch from prefillData.agent', payload.agent, { name: 'Fake Agent', agency: 'Fake Agency', branch: 'Fake Branch' });
  ok('agentCode is never present - buildPrefillData.js never exposes it to client-runtime code', !('agentCode' in payload.agent));
  ok('agent contact fields (phone/email) are omitted here only because this fixture leaves them blank, not because they are excluded', !('phone' in payload.agent) && !('email' in payload.agent));

  const contactableAgentPrefill = { ...fakePrefillData, agent: { name: 'Fake Agent', agency: 'Fake Agency', branch: 'Fake Branch', phone: '012-3456789', email: 'agent@example.com' } };
  const contactableAgentPayload = buildSubmissionPayload(contactableAgentPrefill, fakeFormState, {}, { submissionId: 'sub-1e' });
  check('agent phone/email ARE included once present, so the Clients table can populate Agent Phone/Agent Email', { phone: contactableAgentPayload.agent.phone, email: contactableAgentPayload.agent.email }, { phone: '012-3456789', email: 'agent@example.com' });

  const partialAgentPrefill = { ...fakePrefillData, agent: { name: 'Solo Agent', agency: null, branch: null, phone: '', email: '' } };
  const partialAgentPayload = buildSubmissionPayload(partialAgentPrefill, fakeFormState, {}, { submissionId: 'sub-1b' });
  check('unknown agent fields are omitted, not sent as null/placeholder', partialAgentPayload.agent, { name: 'Solo Agent' });

  const noAgentPrefill = { ...fakePrefillData, agent: undefined };
  const noAgentPayload = buildSubmissionPayload(noAgentPrefill, fakeFormState, {}, { submissionId: 'sub-1c' });
  check('missing prefillData.agent entirely still produces a safe empty object, never throws', noAgentPayload.agent, {});

  const noMatchFormState = { ...fakeFormState, plan: 'A Plan Name That Was Never Compared' };
  const noMatchPayload = buildSubmissionPayload(fakePrefillData, noMatchFormState, {}, { submissionId: 'sub-1f' });
  check('selectedPlanDetails falls back to { planName } (never dropped) if the chosen name has no match in plansCompared', noMatchPayload.selectedPlanDetails, { planName: 'A Plan Name That Was Never Compared' });

  const noPlanFormState = { ...fakeFormState, plan: '' };
  const noPlanPayload = buildSubmissionPayload(fakePrefillData, noPlanFormState, {}, { submissionId: 'sub-1g' });
  check('selectedPlanDetails is null when no plan was selected at all', noPlanPayload.selectedPlanDetails, null);

  const documentsPayload = buildSubmissionPayload(fakePrefillData, fakeFormState, { nricFront: { filename: 'ic.jpg', mimeType: 'image/jpeg', base64: 'ZmFrZQ==' } }, { submissionId: 'sub-1d' });
  check('documents section carries through base64-encoded uploads keyed by field name', documentsPayload.documents, { nricFront: { filename: 'ic.jpg', mimeType: 'image/jpeg', base64: 'ZmFrZQ==' } });
  check('a submission with no documents still gets a (empty) documents object, never undefined', payload.documents, {});

  // Backward compatibility: the frozen Phase 4 function this wraps must
  // still work completely unmodified and produce its original shape.
  const { buildSubmission } = require('../../browser-tool/application/submission.js');
  const legacy = buildSubmission(fakePrefillData, fakeFormState);
  check('legacy buildSubmission() shape is untouched', Object.keys(legacy).sort(), ['application', 'client', 'quotation', 'timestamp'].sort());
  check('legacy client.fullName still reads correctly', legacy.client.fullName, 'Test Client');
}

console.log('\n=== SubmissionQueue: enqueue / resolve / duplicate detection ===');
{
  const queue = createQueue();
  check('a never-seen submissionId has not resolved', queue.hasResolved('q-1'), false);

  queue.enqueue('q-1', { some: 'payload' }, { type: 'network', message: 'boom' });
  check('failed attempt appears in pending list', queue.listPending().map((e) => e.submissionId), ['q-1']);
  check('a pending (not yet resolved) id still reports unresolved', queue.hasResolved('q-1'), false);

  queue.markResolved('q-1', 'REF-1');
  check('resolved id now reports resolved', queue.hasResolved('q-1'), true);
  check('resolved id no longer appears in pending list', queue.listPending().map((e) => e.submissionId), []);
  check('reference is retrievable after resolution', queue.getReference('q-1'), 'REF-1');

  queue.markResolved('q-2-never-enqueued', 'REF-2');
  check('markResolved works even without a prior enqueue call (first-attempt success)', queue.hasResolved('q-2-never-enqueued'), true);
}

console.log('\n=== SubmissionQueue: resolved entries do not retain PII/documents (persistent/localStorage path) ===');
{
  // Node has no `localStorage` global - a minimal in-memory polyfill lets
  // this exercise the REAL persistent-storage code path (readAll/writeAll
  // via JSON in localStorage), not just the in-memory fallback every
  // other test in this file runs under.
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    const queue = createQueue();
    ok('this queue instance is actually using the persistent (localStorage) path, not the in-memory fallback', queue.isPersistent());

    const sensitivePayload = {
      applicant: { nric: '900101-01-1234' },
      documents: { nricFront: { filename: 'ic.jpg', mimeType: 'image/jpeg', base64: 'ZmFrZS1iYXNlNjQtaWMtcGhvdG8=' } },
    };
    queue.enqueue('q-pii-1', sensitivePayload, { type: 'network', message: 'boom' });
    ok('the failed attempt\'s payload (incl. base64 ID photo) really did get written to localStorage', JSON.stringify(store).includes('fake-base64-ic-photo') === false && JSON.stringify(store).includes('ZmFrZS1iYXNlNjQtaWMtcGhvdG8='));

    queue.markResolved('q-pii-1', 'REF-PII-1');
    ok(
      'once resolved, the base64 document payload is gone from localStorage entirely - it does not linger after a successful retry',
      !JSON.stringify(store).includes('ZmFrZS1iYXNlNjQtaWMtcGhvdG8=') && !JSON.stringify(store).includes('900101-01-1234')
    );
    check('the reference is still retrievable after the payload is cleared', queue.getReference('q-pii-1'), 'REF-PII-1');
  } finally {
    delete global.localStorage;
  }
}

console.log('\n=== SubmissionService: success via MockDestination ===');
{
  const queue = createQueue();
  const payload = { version: '1.0', quotation: {}, applicant: { fullName: 'X' }, beneficiaries: [], metadata: { submissionId: 'svc-1' } };
  return (async () => {
    const result = await SubmissionService.submit(payload, { destination: createMockDestination({ result: 'success' }), queue });
    check('status is success', result.status, 'success');
    ok('a reference is returned', typeof result.reference === 'string' && result.reference.length > 0);
    check('queue now shows this submissionId resolved', queue.hasResolved('svc-1'), true);

    console.log('\n=== SubmissionService: simulated failure -> queued -> retry succeeds ===');
    const failPayload = { version: '1.0', quotation: {}, applicant: { fullName: 'Y' }, beneficiaries: [], metadata: { submissionId: 'svc-2' } };
    const failResult = await SubmissionService.submit(failPayload, { destination: createMockDestination({ result: 'failure', failureType: 'server' }), queue });
    check('status is failed', failResult.status, 'failed');
    check('error is classified with the destination-provided type', failResult.error.type, 'server');
    check('failed attempt is queued', failResult.queued, true);
    check('failed payload is present in the queue pending list (never discarded)', queue.listPending().find((e) => e.submissionId === 'svc-2').payload, failPayload);

    const retryResult = await SubmissionService.submit(failPayload, { destination: createMockDestination({ result: 'success' }), queue });
    check('retry with the SAME payload succeeds', retryResult.status, 'success');
    check('queue no longer shows svc-2 as pending after a successful retry', queue.listPending().find((e) => e.submissionId === 'svc-2'), undefined);

    console.log('\n=== SubmissionService: duplicate submit is blocked (idempotency) ===');
    const dupeDestination = createMockDestination({ result: 'failure' }); // if this were called, the test below would see 'failed', proving dedupe short-circuited before reaching it
    const dupeResult = await SubmissionService.submit(payload, { destination: dupeDestination, queue });
    check('re-submitting an already-resolved submissionId short-circuits to success without re-invoking the destination', dupeResult, { status: 'success', submissionId: 'svc-1', reference: dupeResult.reference, deduped: true });

    console.log('\n=== SubmissionService: timeout classification ===');
    const timeoutPayload = { version: '1.0', quotation: {}, applicant: { fullName: 'Z' }, beneficiaries: [], metadata: { submissionId: 'svc-3' } };
    const timeoutResult = await SubmissionService.submit(timeoutPayload, { destination: createMockDestination({ result: 'timeout' }), queue });
    check('timeout is classified correctly', timeoutResult.error.type, 'timeout');

    console.log('\n=== SubmissionService: malformed payload -> validation error, destination never called ===');
    let destinationWasCalled = false;
    const trackedDestination = { send: async () => { destinationWasCalled = true; return { reference: 'x' }; } };
    const badResult = await SubmissionService.submit({ version: '1.0', metadata: { submissionId: 'svc-4' } }, { destination: trackedDestination, queue });
    check('validation error is returned', badResult.error.type, 'validation');
    check('destination.send() was never invoked for an invalid payload', destinationWasCalled, false);

    console.log('\n=== ConsoleDestination: always resolves locally ===');
    const consoleResult = await ConsoleDestination.send({ hello: 'world' });
    ok('resolves with a synthetic reference', typeof consoleResult.reference === 'string');

    console.log('\n=== AirtableDestination: request shape against a mocked fetch (no real network call) ===');
    let capturedUrl = null;
    let capturedBody = null;
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ reference: 'recFAKE123' }) };
    };
    try {
      check('send() rejects with not_configured before configure() is called', await AirtableDestination.send({ metadata: { submissionId: 'at-1' } }).catch((e) => e.type), 'not_configured');
      AirtableDestination.configure({ webhookUrl: 'https://hooks.airtable.com/workflows/v1/genericWebhook/fake-test-only' });
      const atResult = await AirtableDestination.send({ version: '1.0', metadata: { submissionId: 'at-1' }, applicant: { fullName: 'X' } });
      check('resolves with the reference the webhook echoed back', atResult.reference, 'recFAKE123');
      ok('POSTed to the configured webhook URL', capturedUrl === 'https://hooks.airtable.com/workflows/v1/genericWebhook/fake-test-only');
      check('request body is the exact payload, unmodified', capturedBody.metadata.submissionId, 'at-1');

      console.log('\n=== Regression: clientRuntime.js\'s actual wiring pattern (configure() then use the MODULE as destination) ===');
      // clientRuntime.js does `AirtableDestination.configure({...})` for its
      // side effect, then hands the AirtableDestination module itself (not
      // configure()'s return value) to SubmissionService.submit() as
      // `destination`. A prior real bug passed `configure()`'s return value
      // instead - undefined, since configure() has no `return` statement -
      // which made every real submission fail with "a destination with a
      // send() function is required." This regression test exercises the
      // exact call shape clientRuntime.js uses, through SubmissionService,
      // not AirtableDestination.send() directly (the tests above already
      // covered that layer and still didn't catch the wiring bug).
      ok('configure() returns undefined - a reminder that its return value must never be used as a destination', AirtableDestination.configure({ webhookUrl: 'https://hooks.airtable.com/workflows/v1/genericWebhook/fake-test-only' }) === undefined);
      const wiringQueue = createQueue();
      const wiringResult = await SubmissionService.submit(
        { version: '1.2', quotation: {}, applicant: { fullName: 'Wiring Check' }, beneficiaries: [], metadata: { submissionId: 'wiring-1' } },
        { destination: AirtableDestination, queue: wiringQueue }
      );
      check('a submission built the way clientRuntime.js actually builds it succeeds end-to-end', wiringResult.status, 'success');
    } finally {
      global.fetch = originalFetch;
      AirtableDestination.configure({ webhookUrl: null });
    }

    console.log(`\n${pass} passed, ${fail} failed.`);
    process.exit(fail > 0 ? 1 : 0);
  })();
}
