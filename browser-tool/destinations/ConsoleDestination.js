/**
 * ConsoleDestination.js
 *
 * CLIENT-RUNTIME destination adapter - logs the payload to the console
 * and resolves immediately with a synthetic local reference. Zero
 * config, zero network, always available. Useful for local development
 * and as a last-resort fallback; not meant for production submissions.
 *
 * Implements the common destination interface every adapter shares:
 *   send(payload) -> Promise<{ reference: string }>
 *   (rejects with an Error, optionally carrying a `.type` classification)
 */

'use strict';

function send(payload) {
  const reference = `LOCAL-${Date.now().toString(36).toUpperCase()}`;
  if (typeof console !== 'undefined') {
    console.log('[ConsoleDestination] submission received (not sent anywhere):', payload);
  }
  return Promise.resolve({ reference });
}

const ConsoleDestination = { name: 'console', send };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConsoleDestination;
}
