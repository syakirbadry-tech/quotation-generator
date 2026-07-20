/**
 * SubmissionQueue.js
 *
 * CLIENT-RUNTIME module - a small localStorage-backed durable queue for
 * submission attempts. Two jobs: (1) never lose a payload that failed to
 * reach its destination (persist it so "Retry Submission" survives a
 * refresh, when the browser's storage cooperates), and (2) let
 * SubmissionService short-circuit a duplicate submit by checking whether
 * a given submissionId has already resolved successfully.
 *
 * `localStorage` under a `file://` origin behaves inconsistently across
 * browsers (some partition or disable it per-file) - this degrades to an
 * in-memory-only queue with a console warning if storage isn't usable,
 * rather than throwing. Either way it never blocks a submission attempt.
 */

'use strict';

const STORAGE_KEY = 'prubsn_submission_queue_v1';

function hasWorkingLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const probeKey = `${STORAGE_KEY}_probe`;
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return true;
  } catch (e) {
    return false;
  }
}

function createQueue() {
  const persistent = hasWorkingLocalStorage();
  let memoryEntries = [];

  if (!persistent && typeof console !== 'undefined') {
    console.warn('SubmissionQueue: localStorage is unavailable in this context; falling back to in-memory-only queue (entries will not survive a page reload).');
  }

  function readAll() {
    if (!persistent) return memoryEntries;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeAll(entries) {
    if (!persistent) {
      memoryEntries = entries;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      // Storage full/unavailable mid-session - the in-memory copy in the
      // caller's own state is still the source of truth for this page
      // load, so a failed write here never loses the current session's
      // data, only the ability to resume it after a reload.
    }
  }

  /** Adds or updates a queue entry for this submissionId (never duplicates one). */
  function enqueue(submissionId, payload, error) {
    const entries = readAll();
    const existing = entries.find((e) => e.submissionId === submissionId);
    const now = new Date().toISOString();
    if (existing) {
      existing.payload = payload;
      existing.lastError = error || null;
      existing.attempts += 1;
      existing.updatedAt = now;
    } else {
      entries.push({
        submissionId,
        payload,
        resolved: false,
        attempts: 1,
        lastError: error || null,
        createdAt: now,
        updatedAt: now,
      });
    }
    writeAll(entries);
  }

  /** Marks a submissionId as successfully resolved (creating the entry if this is the first record of it); kept in the log, not deleted, so hasResolved() can dedupe future attempts. */
  function markResolved(submissionId, reference) {
    const entries = readAll();
    const existing = entries.find((e) => e.submissionId === submissionId);
    const now = new Date().toISOString();
    if (existing) {
      existing.resolved = true;
      existing.reference = reference || null;
      existing.updatedAt = now;
    } else {
      entries.push({
        submissionId,
        payload: null,
        resolved: true,
        reference: reference || null,
        attempts: 1,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    writeAll(entries);
  }

  function hasResolved(submissionId) {
    const existing = readAll().find((e) => e.submissionId === submissionId);
    return Boolean(existing && existing.resolved);
  }

  function getReference(submissionId) {
    const existing = readAll().find((e) => e.submissionId === submissionId);
    return existing && existing.resolved ? existing.reference : null;
  }

  /** All unresolved entries - the actual "never discard a failed payload" list. */
  function listPending() {
    return readAll().filter((e) => !e.resolved);
  }

  function isPersistent() {
    return persistent;
  }

  return { enqueue, markResolved, hasResolved, getReference, listPending, isPersistent };
}

const PruBSNSubmissionQueue = { createQueue };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PruBSNSubmissionQueue;
}
