/**
 * hash-password.mjs
 *
 * Generates the ADMIN_PASSWORD_HASH secret for the admin dashboard (see
 * src/admin.js). The password itself is never stored anywhere - only this
 * salted PBKDF2 hash.
 *
 * Usage:
 *   node scripts/hash-password.mjs 'your-strong-password'
 *   npx wrangler secret put ADMIN_PASSWORD_HASH     # paste the printed value
 */

import { webcrypto } from 'node:crypto';
import { pbkdf2 } from '../src/admin.js';

// 100000 is the highest PBKDF2 iteration count Cloudflare Workers allows.
const ITERATIONS = 100000;

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: node scripts/hash-password.mjs <password>   (at least 12 characters)');
  process.exit(1);
}

const salt = webcrypto.getRandomValues(new Uint8Array(16));
const hash = await pbkdf2(password, salt, ITERATIONS);
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
console.log(`pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`);
