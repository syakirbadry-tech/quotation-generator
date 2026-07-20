/**
 * SubmissionService.js
 *
 * CLIENT-RUNTIME module - the ONLY thing the UI (clientRuntime.js) is
 * allowed to call to submit an application. Orchestrates the queue and
 * an injected destination adapter; never imports or knows about any
 * specific destination (Airtable, console, mock, or anything future)
 * itself - that's the whole point of the adapter boundary.
 *
 * Contract: submit() never throws and never rejects - every outcome,
 * success or failure, is a resolved `{ status, submissionId, ... }`
 * object, so a caller can always safely `await` it and branch on
 * `status` without a try/catch. This is deliberate: a thrown error here
 * would be one more way to accidentally lose a client's completed
 * application on an unhandled rejection.
 */

'use strict';

const { createQueue } = require('../queue/SubmissionQueue');

// One shared queue per page load, so repeated submit()/retry calls from
// the same session all see the same pending/resolved state without every
// caller having to thread a queue instance through by hand. A caller can
// still pass its own queue (e.g. for test isolation).
const defaultQueue = createQueue();

function classifyError(err) {
  const type = (err && err.type) || 'unknown';
  const message = (err && err.message) || 'Submission failed for an unknown reason.';
  return { type, message };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Payload is missing.';
  if (!payload.metadata || !payload.metadata.submissionId) return 'Payload is missing metadata.submissionId.';
  if (!payload.applicant || typeof payload.applicant !== 'object') return 'Payload is missing applicant details.';
  if (!Array.isArray(payload.beneficiaries)) return 'Payload is missing a beneficiaries array.';
  return null;
}

/**
 * @param {object} payload the versioned envelope from models/SubmissionPayload.js
 * @param {{ destination: {name: string, send: Function}, queue?: object }} options
 * @returns {Promise<{status: 'success'|'failed', submissionId: string, reference?: string, error?: {type: string, message: string}, deduped?: boolean, queued?: boolean}>}
 */
async function submit(payload, options) {
  const { destination, queue = defaultQueue } = options || {};
  if (!destination || typeof destination.send !== 'function') {
    throw new Error('SubmissionService.submit: a destination with a send() function is required.');
  }

  const submissionId = payload && payload.metadata && payload.metadata.submissionId;

  const validationMessage = validatePayload(payload);
  if (validationMessage) {
    const error = { type: 'validation', message: validationMessage };
    if (submissionId) queue.enqueue(submissionId, payload, error);
    return { status: 'failed', submissionId: submissionId || null, error, queued: Boolean(submissionId) };
  }

  if (queue.hasResolved(submissionId)) {
    return { status: 'success', submissionId, reference: queue.getReference(submissionId), deduped: true };
  }

  // Recorded as pending BEFORE the destination is called (not just after a
  // failure is known) - so the payload is durable even if the tab closes
  // mid-request, per "never discard payload".
  queue.enqueue(submissionId, payload, null);

  try {
    const result = await destination.send(payload);
    queue.markResolved(submissionId, result && result.reference);
    return { status: 'success', submissionId, reference: result && result.reference };
  } catch (err) {
    const error = classifyError(err);
    queue.enqueue(submissionId, payload, error);
    return { status: 'failed', submissionId, error, queued: true };
  }
}

/** Every payload currently queued but not yet successfully submitted - for a future "pending submissions" view if ever needed; not otherwise used in this phase. */
function listPending(queue = defaultQueue) {
  return queue.listPending();
}

const SubmissionService = { submit, listPending, defaultQueue };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SubmissionService;
}
