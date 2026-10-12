/**
 * admin.js
 *
 * Staff-only dashboard API for overseeing client submissions - the
 * read side of the Clients table that /submit writes to. Used by the
 * admin login + dashboard pages hosted on GitHub Pages
 * (syakirbadry-tech/Client-Form, admin/).
 *
 * Unlike /submit (a public form - see worker.js's header comment for why
 * it has no auth), every route here returns client PII (NRIC, bank
 * details, IC photos), so every route except /admin/login requires a
 * valid session token:
 *
 *   POST  /admin/login              { username, password } -> { token, expiresAt }
 *   GET   /admin/submissions        -> { submissions: [summary...] }
 *   GET   /admin/submissions/:id    -> { submission: { id, createdTime, fields } }
 *   PATCH /admin/submissions/:id    { status } -> { submission: {...} }
 *
 * Credentials and signing key live only in Worker secrets, never in the
 * browser:
 *   ADMIN_USERNAME          plain username
 *   ADMIN_PASSWORD_HASH     "pbkdf2$<iterations>$<saltB64>$<hashB64>" - generate
 *                           with `node scripts/hash-password.mjs`
 *   ADMIN_SESSION_SECRET    random string (32+ chars) used to HMAC-sign tokens
 *
 * The session token is stateless: base64url(JSON claims) + "." +
 * base64url(HMAC-SHA256(claims)). Rotating ADMIN_SESSION_SECRET signs
 * everyone out immediately.
 *
 * CORS for these routes is restricted to ADMIN_ALLOWED_ORIGIN (the
 * dashboard's own origin), not the public form's "*".
 */

import { checkRateLimit } from './rateLimit.js';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_ATTEMPTS_PER_MINUTE = 5;
const MAX_LIST_RECORDS = 2000;
const MAX_LOGIN_BODY_BYTES = 4096;

export const SUBMISSION_STATUSES = ['Received', 'In Review', 'Documents Verified', 'Approved', 'Rejected', 'Needs Follow-up'];

// Columns the list view needs - the full record (bank details, medical,
// photos) is only sent when one submission is opened.
const SUMMARY_FIELDS = {
  fullName: 'Full Name',
  nric: 'NRIC',
  phone: 'Phone Number',
  email: 'Email',
  plan: 'Selected Plan',
  status: 'Submission Status',
  submittedAt: 'Submitted At',
  employmentType: 'Employment Type',
  maritalStatus: 'Marital Status',
};

const encoder = new TextEncoder();

function adminCorsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ADMIN_ALLOWED_ORIGIN || 'https://syakirbadry-tech.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...adminCorsHeaders(env),
    },
  });
}

function fail(error, code, status, env) {
  return json({ success: false, error, code }, status, env);
}

function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64Decode(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

/** Constant-time comparison so response timing doesn't leak how much of a secret matched. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(secret, data) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data));
  return new Uint8Array(sig);
}

export async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Verifies a password against an ADMIN_PASSWORD_HASH string ("pbkdf2$iterations$saltB64$hashB64"). */
export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const expected = b64Decode(parts[3]);
  const actual = await pbkdf2(String(password), b64Decode(parts[2]), iterations);
  return timingSafeEqual(actual, expected);
}

export async function createSessionToken(env, username, nowSeconds = Math.floor(Date.now() / 1000)) {
  const claims = { sub: username, iat: nowSeconds, exp: nowSeconds + SESSION_TTL_SECONDS };
  const body = b64urlEncode(encoder.encode(JSON.stringify(claims)));
  const sig = b64urlEncode(await sign(env.ADMIN_SESSION_SECRET, body));
  return { token: `${body}.${sig}`, expiresAt: claims.exp };
}

/** @returns {Promise<object|null>} the token's claims if its signature is valid and it hasn't expired */
export async function verifySessionToken(env, token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  let claims;
  try {
    const expected = await sign(env.ADMIN_SESSION_SECRET, body);
    if (!timingSafeEqual(b64urlDecode(sig), expected)) return null;
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch (e) {
    return null;
  }
  if (!claims || typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
  if (claims.sub !== env.ADMIN_USERNAME) return null;
  return claims;
}

function airtableUrl(env, suffix = '') {
  return `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_ID)}${suffix}`;
}

async function airtableFetch(env, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body && body.error && (body.error.message || body.error.type)) || `Airtable responded with HTTP ${res.status}`;
    throw Object.assign(new Error(message), { airtableStatus: res.status });
  }
  return body;
}

function toSummary(record) {
  const f = record.fields || {};
  const summary = { id: record.id, createdTime: record.createdTime };
  for (const [key, field] of Object.entries(SUMMARY_FIELDS)) {
    summary[key] = f[field] ?? null;
  }
  return summary;
}

async function listSubmissions(env) {
  const submissions = [];
  let offset;
  do {
    const params = new URLSearchParams();
    for (const field of Object.values(SUMMARY_FIELDS)) params.append('fields[]', field);
    params.set('pageSize', '100');
    if (offset) params.set('offset', offset);
    const body = await airtableFetch(env, airtableUrl(env, `?${params}`));
    for (const record of body.records || []) submissions.push(toSummary(record));
    offset = body.offset;
  } while (offset && submissions.length < MAX_LIST_RECORDS);

  // Newest first; records without "Submitted At" fall back to Airtable's own creation time.
  const when = (s) => Date.parse(s.submittedAt || s.createdTime) || 0;
  submissions.sort((a, b) => when(b) - when(a));
  return submissions;
}

function isRecordId(id) {
  return /^rec[A-Za-z0-9]{14}$/.test(id);
}

async function handleLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env.RATE_LIMIT_KV, `admin-login:${ip}`, LOGIN_ATTEMPTS_PER_MINUTE);
  if (rl.limited) {
    return fail('Too many login attempts. Please wait a minute and try again.', 'rate_limited', 429, env);
  }

  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_LOGIN_BODY_BYTES) return fail('Request too large.', 'payload_too_large', 413, env);
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    return fail('Invalid request.', 'invalid_json', 400, env);
  }
  const username = creds && typeof creds.username === 'string' ? creds.username.trim() : '';
  const password = creds && typeof creds.password === 'string' ? creds.password : '';

  // Always run the (slow) hash check, even for an unknown username, so
  // response time doesn't reveal whether the username was right.
  const passwordOk = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
  const usernameOk = timingSafeEqual(encoder.encode(username), encoder.encode(env.ADMIN_USERNAME));
  if (!passwordOk || !usernameOk) {
    return fail('Incorrect username or password.', 'invalid_credentials', 401, env);
  }

  const session = await createSessionToken(env, env.ADMIN_USERNAME);
  return json({ success: true, ...session }, 200, env);
}

async function handleUpdateStatus(request, env, id) {
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch (e) {
    return fail('Invalid request.', 'invalid_json', 400, env);
  }
  const status = body && body.status;
  if (!SUBMISSION_STATUSES.includes(status)) {
    return fail('Unknown status.', 'invalid_status', 400, env);
  }
  const record = await airtableFetch(env, airtableUrl(env, `/${id}`), {
    method: 'PATCH',
    body: JSON.stringify({ fields: { 'Submission Status': status } }),
  });
  return json({ success: true, submission: toSummary(record) }, 200, env);
}

/** Handles every /admin/* request. Returns null for paths it doesn't own. */
export async function handleAdmin(request, env, path) {
  if (!path.startsWith('/admin/')) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: adminCorsHeaders(env) });
  }

  const missing = ['ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET', 'AIRTABLE_PAT', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_ID'].filter((k) => !env[k]);
  if (missing.length) {
    console.error('Admin API misconfigured - missing:', missing.join(', '));
    return fail('Admin dashboard is not configured.', 'not_configured', 500, env);
  }

  try {
    if (path === '/admin/login') {
      if (request.method !== 'POST') return fail('Method not allowed - use POST.', 'method_not_allowed', 405, env);
      return await handleLogin(request, env);
    }

    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!(await verifySessionToken(env, token))) {
      return fail('Your session has expired. Please sign in again.', 'unauthorized', 401, env);
    }

    if (path === '/admin/submissions') {
      if (request.method !== 'GET') return fail('Method not allowed - use GET.', 'method_not_allowed', 405, env);
      return json({ success: true, submissions: await listSubmissions(env) }, 200, env);
    }

    if (path.startsWith('/admin/submissions/')) {
      const id = path.slice('/admin/submissions/'.length);
      if (!isRecordId(id)) return fail('Not found.', 'not_found', 404, env);
      if (request.method === 'GET') {
        const record = await airtableFetch(env, airtableUrl(env, `/${id}`));
        return json({ success: true, submission: { id: record.id, createdTime: record.createdTime, fields: record.fields || {} } }, 200, env);
      }
      if (request.method === 'PATCH') return await handleUpdateStatus(request, env, id);
      return fail('Method not allowed.', 'method_not_allowed', 405, env);
    }

    return fail('Not found.', 'not_found', 404, env);
  } catch (err) {
    console.error('Admin API error:', err && err.message);
    if (err && err.airtableStatus === 404) return fail('Not found.', 'not_found', 404, env);
    return fail('Could not load data from Airtable. Please try again.', 'airtable_error', 502, env);
  }
}
