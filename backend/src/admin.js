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
 *   POST  /admin/login              { username, password } -> { token, expiresAt, user }
 *   POST  /admin/set-password       { username, code, password } -> { token, expiresAt, user }
 *   GET   /admin/submissions        -> { submissions: [summary...] }
 *   GET   /admin/submissions/:id    -> { submission: { id, createdTime, fields } }
 *   PATCH /admin/submissions/:id    { status } -> { submission: {...} }
 *   GET   /admin/team               (owner) -> { users: [...] }
 *   POST  /admin/team               (owner) { name, email, role } -> { user }
 *   PATCH /admin/team/:id           (owner) { active?, role? } -> { user }
 *   POST  /admin/team/:id/setup-code (owner) -> { code, expiresAt, user }
 *
 * Who sees what:
 *   owner   the ADMIN_USERNAME account - every client, and manages the team
 *   leader  every client
 *   agent   only clients whose "Agent Email" is their own login email
 *           (set by their personal form link, ?agent=<Form Code> - see
 *           worker.js's handleSubmit)
 * Leaders and agents live in the Airtable "Dashboard Users" table (see
 * users.js); they set their own password with a one-time setup code the
 * owner generates on the Team page, so nobody else ever sees it.
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
import {
  airtableFetch, formulaString, isEmail, findUserByEmail, getUser, listUsers, createUser, updateUser, publicUser, suggestFormCode,
} from './users.js';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SETUP_CODE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
// Cloudflare Workers cap PBKDF2 at 100k iterations.
const NEW_HASH_ITERATIONS = 100000;
// Verified against when the username is unknown, so a miss costs the same time as a hit.
const DUMMY_PASSWORD_HASH = `pbkdf2$${NEW_HASH_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;
const LOGIN_ATTEMPTS_PER_MINUTE = 5;
const MAX_LIST_RECORDS = 2000;
const MAX_LOGIN_BODY_BYTES = 4096;

export const SUBMISSION_STATUSES = ['Received', 'In Review', 'Documents Verified', 'Approved', 'Rejected', 'Needs Follow-up'];

// Columns the list and Insights views need - the full record (bank
// details, medical, photos) is only sent when one submission is opened.
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
  dateOfBirth: 'Date of Birth',
  occupation: 'Occupation',
  fieldOfWork: 'Field of Work',
  monthlyIncome: 'Monthly Income',
  agentName: 'Agent Name',
  agentEmail: 'Agent Email',
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

function b64Encode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(String(password), salt, NEW_HASH_ITERATIONS);
  return `pbkdf2$${NEW_HASH_ITERATIONS}$${b64Encode(salt)}$${b64Encode(hash)}`;
}

async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Setup codes are typed by hand, so compare them case- and dash-insensitively. */
function normalizeSetupCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateSetupCode() {
  const chars = [];
  while (chars.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      // Rejection sampling keeps every character equally likely.
      if (b < 248 && chars.length < 10) chars.push(SETUP_CODE_ALPHABET[b % SETUP_CODE_ALPHABET.length]);
    }
  }
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

/**
 * kind "owner" tokens name ADMIN_USERNAME in sub; kind "user" tokens carry the
 * Dashboard Users record id in uid and are re-checked against the table on use.
 */
export async function createSessionToken(env, username, nowSeconds = Math.floor(Date.now() / 1000), extra = {}) {
  const claims = { sub: username, ...extra, iat: nowSeconds, exp: nowSeconds + SESSION_TTL_SECONDS };
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
  if (claims.kind === 'user') return typeof claims.uid === 'string' ? claims : null;
  if (claims.sub !== env.ADMIN_USERNAME) return null;
  return claims;
}

/** Turns valid token claims into the signed-in person, or null if their account no longer allows access. */
async function resolveViewer(env, claims) {
  if (claims.kind !== 'user') {
    return { kind: 'owner', role: 'owner', name: env.ADMIN_USERNAME, email: String(env.ADMIN_USERNAME).toLowerCase(), seesAll: true };
  }
  if (!env.AIRTABLE_USERS_TABLE_ID || !/^rec[A-Za-z0-9]{14}$/.test(claims.uid)) return null;
  let user;
  try {
    user = await getUser(env, claims.uid);
  } catch (err) {
    if (err && err.airtableStatus === 404) return null;
    throw err;
  }
  // Deactivated, re-roled away, email changed, or password reset since this token was issued.
  if (!user.active || !user.role || !user.passwordHash || user.email !== claims.sub) return null;
  if (user.passwordSetAt && Math.floor(Date.parse(user.passwordSetAt) / 1000) > claims.iat) return null;
  return { kind: 'user', role: user.role, name: user.name, email: user.email, seesAll: user.role === 'leader', id: user.id };
}

function viewerInfo(viewer) {
  return { name: viewer.name, email: viewer.email, role: viewer.role };
}

function canAccess(viewer, fields) {
  if (viewer.seesAll) return true;
  return String((fields && fields['Agent Email']) || '').trim().toLowerCase() === viewer.email;
}

function airtableUrl(env, suffix = '') {
  return `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_ID)}${suffix}`;
}

function toSummary(record) {
  const f = record.fields || {};
  const summary = { id: record.id, createdTime: record.createdTime };
  for (const [key, field] of Object.entries(SUMMARY_FIELDS)) {
    summary[key] = f[field] ?? null;
  }
  return summary;
}

async function listSubmissions(env, viewer) {
  const submissions = [];
  let offset;
  do {
    const params = new URLSearchParams();
    for (const field of Object.values(SUMMARY_FIELDS)) params.append('fields[]', field);
    if (!viewer.seesAll) params.set('filterByFormula', `LOWER(TRIM({Agent Email})) = ${formulaString(viewer.email)}`);
    params.set('pageSize', '100');
    if (offset) params.set('offset', offset);
    const body = await airtableFetch(env, airtableUrl(env, `?${params}`));
    for (const record of body.records || []) {
      if (canAccess(viewer, record.fields)) submissions.push(toSummary(record));
    }
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

async function readJsonBody(request, env) {
  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_LOGIN_BODY_BYTES) return { error: fail('Request too large.', 'payload_too_large', 413, env) };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return { body };
  } catch (e) {
    return { error: fail('Invalid request.', 'invalid_json', 400, env) };
  }
}

async function userSession(env, user) {
  const session = await createSessionToken(env, user.email, undefined, { kind: 'user', uid: user.id });
  return { ...session, user: { name: user.name, email: user.email, role: user.role } };
}

async function handleLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env.RATE_LIMIT_KV, `admin-login:${ip}`, LOGIN_ATTEMPTS_PER_MINUTE);
  if (rl.limited) {
    return fail('Too many login attempts. Please wait a minute and try again.', 'rate_limited', 429, env);
  }

  const { body: creds, error } = await readJsonBody(request, env);
  if (error) return error;
  const username = typeof creds.username === 'string' ? creds.username.trim() : '';
  const password = typeof creds.password === 'string' ? creds.password : '';
  const invalid = () => fail('Incorrect username or password.', 'invalid_credentials', 401, env);

  if (timingSafeEqual(encoder.encode(username), encoder.encode(env.ADMIN_USERNAME))) {
    if (!(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) return invalid();
    const session = await createSessionToken(env, env.ADMIN_USERNAME);
    return json({ success: true, ...session, user: { name: env.ADMIN_USERNAME, email: String(env.ADMIN_USERNAME).toLowerCase(), role: 'owner' } }, 200, env);
  }

  // Team member. Always run the (slow) hash check, even for an unknown
  // email, so response time doesn't reveal whether the account exists.
  const user = env.AIRTABLE_USERS_TABLE_ID && isEmail(username) ? await findUserByEmail(env, username) : null;
  const usable = user && user.active && user.role && user.passwordHash;
  const passwordOk = await verifyPassword(password, usable ? user.passwordHash : DUMMY_PASSWORD_HASH);
  if (usable && passwordOk) return json({ success: true, ...(await userSession(env, user)) }, 200, env);

  // Signing in with the one-time password the owner gave them: no session
  // yet - they must choose their own password first (POST /admin/set-password).
  if (user && (await setupCodeMatches(user, password))) {
    return fail('Please choose your own password to finish signing in.', 'password_change_required', 403, env);
  }
  return invalid();
}

async function setupCodeMatches(user, code) {
  const normalized = normalizeSetupCode(code);
  const expires = Date.parse(user.setupCodeExpires || '');
  if (!user.active || !user.role || !user.setupCodeHash || normalized.length !== 10) return false;
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  return timingSafeEqual(encoder.encode(await sha256Hex(normalized)), encoder.encode(user.setupCodeHash));
}

async function handleSetPassword(request, env) {
  if (!env.AIRTABLE_USERS_TABLE_ID) return fail('Team accounts are not set up yet.', 'not_configured', 500, env);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env.RATE_LIMIT_KV, `admin-setpw:${ip}`, LOGIN_ATTEMPTS_PER_MINUTE);
  if (rl.limited) {
    return fail('Too many attempts. Please wait a minute and try again.', 'rate_limited', 429, env);
  }

  const { body, error } = await readJsonBody(request, env);
  if (error) return error;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const code = normalizeSetupCode(body.code);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 'weak_password', 400, env);
  }

  const user = isEmail(username) ? await findUserByEmail(env, username) : null;
  if (!user || !(await setupCodeMatches(user, code))) {
    return fail('That email and one-time password do not match, or it has expired. Ask your team owner for a new one.', 'invalid_setup_code', 401, env);
  }

  const updated = await updateUser(env, user.id, {
    passwordHash: await hashPassword(password),
    setupCodeHash: '',
    setupCodeExpires: null,
    passwordSetAt: new Date().toISOString(),
  });
  return json({ success: true, ...(await userSession(env, updated)) }, 200, env);
}

async function handleUpdateStatus(request, env, id, viewer) {
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
  if (!viewer.seesAll) {
    const existing = await airtableFetch(env, airtableUrl(env, `/${id}`));
    if (!canAccess(viewer, existing.fields)) return fail('Not found.', 'not_found', 404, env);
  }
  const record = await airtableFetch(env, airtableUrl(env, `/${id}`), {
    method: 'PATCH',
    body: JSON.stringify({ fields: { 'Submission Status': status } }),
  });
  return json({ success: true, submission: toSummary(record) }, 200, env);
}

async function handleTeam(request, env, path) {
  if (!env.AIRTABLE_USERS_TABLE_ID) return fail('Team accounts are not set up yet.', 'not_configured', 500, env);

  if (path === '/admin/team') {
    if (request.method === 'GET') {
      return json({ success: true, users: (await listUsers(env)).map(publicUser) }, 200, env);
    }
    if (request.method !== 'POST') return fail('Method not allowed.', 'method_not_allowed', 405, env);
    const { body, error } = await readJsonBody(request, env);
    if (error) return error;
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role;
    if (!name || name.length > 100) return fail('Please enter a name.', 'invalid_name', 400, env);
    if (!isEmail(email)) return fail('Please enter a valid email.', 'invalid_email', 400, env);
    if (role !== 'leader' && role !== 'agent') return fail('Role must be Leader or Agent.', 'invalid_role', 400, env);
    if (email === String(env.ADMIN_USERNAME).toLowerCase()) return fail('That email is the owner login.', 'duplicate_email', 409, env);
    const existing = await listUsers(env);
    if (existing.some((u) => u.email === email)) return fail('Someone on the team already uses that email.', 'duplicate_email', 409, env);
    const user = await createUser(env, { name, email, role, formCode: suggestFormCode(name, existing.map((u) => u.formCode)) });
    return json({ success: true, user: publicUser(user) }, 201, env);
  }

  const m = /^\/admin\/team\/(rec[A-Za-z0-9]{14})(\/setup-code)?$/.exec(path);
  if (!m) return fail('Not found.', 'not_found', 404, env);
  const [, id, setupCode] = m;

  if (setupCode) {
    if (request.method !== 'POST') return fail('Method not allowed - use POST.', 'method_not_allowed', 405, env);
    const user = await getUser(env, id);
    if (!user.active) return fail('Activate this person before creating a setup code.', 'inactive', 400, env);
    const code = generateSetupCode();
    const expiresAt = new Date(Date.now() + SETUP_CODE_TTL_SECONDS * 1000).toISOString();
    const updated = await updateUser(env, id, { setupCodeHash: await sha256Hex(normalizeSetupCode(code)), setupCodeExpires: expiresAt });
    return json({ success: true, code, expiresAt, user: publicUser(updated) }, 200, env);
  }

  if (request.method !== 'PATCH') return fail('Method not allowed.', 'method_not_allowed', 405, env);
  const { body, error } = await readJsonBody(request, env);
  if (error) return error;
  const changes = {};
  if (typeof body.active === 'boolean') changes.active = body.active;
  if (body.role !== undefined) {
    if (body.role !== 'leader' && body.role !== 'agent') return fail('Role must be Leader or Agent.', 'invalid_role', 400, env);
    changes.role = body.role;
  }
  if (!Object.keys(changes).length) return fail('Nothing to change.', 'invalid_request', 400, env);
  return json({ success: true, user: publicUser(await updateUser(env, id, changes)) }, 200, env);
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
    if (path === '/admin/set-password') {
      if (request.method !== 'POST') return fail('Method not allowed - use POST.', 'method_not_allowed', 405, env);
      return await handleSetPassword(request, env);
    }

    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const claims = await verifySessionToken(env, token);
    const viewer = claims && (await resolveViewer(env, claims));
    if (!viewer) {
      return fail('Your session has expired. Please sign in again.', 'unauthorized', 401, env);
    }

    if (path === '/admin/me') {
      if (request.method !== 'GET') return fail('Method not allowed - use GET.', 'method_not_allowed', 405, env);
      return json({ success: true, user: viewerInfo(viewer) }, 200, env);
    }

    if (path === '/admin/team' || path.startsWith('/admin/team/')) {
      if (viewer.kind !== 'owner') return fail('Only the owner can manage the team.', 'forbidden', 403, env);
      return await handleTeam(request, env, path);
    }

    if (path === '/admin/submissions') {
      if (request.method !== 'GET') return fail('Method not allowed - use GET.', 'method_not_allowed', 405, env);
      return json({ success: true, submissions: await listSubmissions(env, viewer) }, 200, env);
    }

    if (path.startsWith('/admin/submissions/')) {
      const id = path.slice('/admin/submissions/'.length);
      if (!isRecordId(id)) return fail('Not found.', 'not_found', 404, env);
      if (request.method === 'GET') {
        const record = await airtableFetch(env, airtableUrl(env, `/${id}`));
        if (!canAccess(viewer, record.fields)) return fail('Not found.', 'not_found', 404, env);
        return json({ success: true, submission: { id: record.id, createdTime: record.createdTime, fields: record.fields || {} } }, 200, env);
      }
      if (request.method === 'PATCH') return await handleUpdateStatus(request, env, id, viewer);
      return fail('Method not allowed.', 'method_not_allowed', 405, env);
    }

    return fail('Not found.', 'not_found', 404, env);
  } catch (err) {
    console.error('Admin API error:', err && err.message);
    if (err && err.airtableStatus === 404) return fail('Not found.', 'not_found', 404, env);
    return fail('Could not load data from Airtable. Please try again.', 'airtable_error', 502, env);
  }
}
