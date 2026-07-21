/**
 * validate.js
 *
 * Server-side validation of an incoming SubmissionPayload. The frontend
 * (browser-tool/services/SubmissionService.js) already validates before
 * ever sending a request, but the whole point of this backend is that it
 * is a public endpoint reachable by anything, not just this project's own
 * frontend - it must not trust the client. Deliberately mirrors, rather
 * than duplicates by import, SubmissionService.js's own required-field
 * checks, since the frontend and backend are two separate deployable
 * units with no shared module graph.
 */

export const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024; // 3 documents x up to ~5MB raw (client-enforced) each, base64-inflated, plus JSON overhead
export const MAX_DOCUMENT_BASE64_BYTES = 8 * 1024 * 1024; // generous ceiling per document (base64 form) - the frontend caps the raw file at 5MB, base64 is ~1.34x that

/**
 * @param {number|null} contentLength from the request's Content-Length header, or null if absent/unparseable
 * @returns {string|null} an error message, or null if the size is acceptable (or unknown and must be checked after reading the body)
 */
export function checkContentLength(contentLength) {
  if (contentLength != null && contentLength > MAX_PAYLOAD_BYTES) {
    return `Payload too large (${Math.round(contentLength / 1024 / 1024)}MB) - maximum is ${Math.round(MAX_PAYLOAD_BYTES / 1024 / 1024)}MB.`;
  }
  return null;
}

/**
 * @param {string} rawBody
 * @returns {{ error: string } | { payload: object }}
 */
export function parseJsonBody(rawBody) {
  if (byteLength(rawBody) > MAX_PAYLOAD_BYTES) {
    return { error: `Payload too large - maximum is ${Math.round(MAX_PAYLOAD_BYTES / 1024 / 1024)}MB.` };
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return { error: 'Request body is not valid JSON.' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'Request body must be a JSON object.' };
  }
  return { payload };
}

function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

/**
 * Required-field / shape checks. Returns the first problem found, or null
 * if the payload looks like a genuine SubmissionPayload v1.x object.
 * Intentionally permissive about which exact version/fields beyond these
 * are present - the frontend and this backend should be free to add new
 * optional payload fields without both needing to deploy in lockstep.
 */
export function validatePayloadShape(payload) {
  if (!payload.version || typeof payload.version !== 'string') {
    return 'Payload is missing a version string.';
  }
  if (!payload.metadata || typeof payload.metadata !== 'object') {
    return 'Payload is missing metadata.';
  }
  if (!payload.metadata.submissionId || typeof payload.metadata.submissionId !== 'string') {
    return 'Payload is missing metadata.submissionId.';
  }
  if (!payload.applicant || typeof payload.applicant !== 'object') {
    return 'Payload is missing applicant details.';
  }
  if (!payload.applicant.fullName || typeof payload.applicant.fullName !== 'string') {
    return 'Payload is missing applicant.fullName.';
  }
  if (!Array.isArray(payload.beneficiaries)) {
    return 'Payload is missing a beneficiaries array.';
  }
  const documents = payload.documents;
  if (documents && typeof documents === 'object') {
    for (const [key, doc] of Object.entries(documents)) {
      if (!doc) continue;
      if (typeof doc.base64 !== 'string') {
        return `documents.${key} is missing base64 content.`;
      }
      if (byteLength(doc.base64) > MAX_DOCUMENT_BASE64_BYTES) {
        return `documents.${key} is too large.`;
      }
    }
  }
  return null;
}
