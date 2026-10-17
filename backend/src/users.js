/**
 * users.js
 *
 * Dashboard staff accounts (leaders and agents), stored in the Airtable
 * "Dashboard Users" table (AIRTABLE_USERS_TABLE_ID) in the same base as
 * Clients. The owner account is NOT in this table - it stays in the
 * Worker secrets (ADMIN_USERNAME / ADMIN_PASSWORD_HASH), so a mistake in
 * the table can never lock the owner out.
 *
 * Columns (by name): Name, Email, Role (Leader | Agent), Active,
 * Form Code, Password Hash, Setup Code Hash, Setup Code Expires,
 * Password Set At. Hash columns are only ever written by the Worker.
 */

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

export const ROLES = { Leader: 'leader', Agent: 'agent' };
const ROLE_LABELS = { leader: 'Leader', agent: 'Agent' };

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const FORM_CODE_RE = /^[a-z0-9-]{1,32}$/;

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

export function isFormCode(value) {
  return typeof value === 'string' && FORM_CODE_RE.test(value);
}

export async function airtableFetch(env, url, init = {}) {
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

function usersUrl(env, suffix = '') {
  return `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_USERS_TABLE_ID)}${suffix}`;
}

/** Airtable formula string literal. Callers also validate input against a strict pattern first. */
export function formulaString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function toUser(record) {
  const f = record.fields || {};
  return {
    id: record.id,
    name: f['Name'] || '',
    email: String(f['Email'] || '').trim().toLowerCase(),
    role: ROLES[f['Role']] || null,
    active: f['Active'] === true,
    formCode: f['Form Code'] || '',
    passwordHash: f['Password Hash'] || '',
    setupCodeHash: f['Setup Code Hash'] || '',
    setupCodeExpires: f['Setup Code Expires'] || null,
    passwordSetAt: f['Password Set At'] || null,
  };
}

/** What the Team page may see - never the hashes. */
export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    formCode: user.formCode,
    hasPassword: Boolean(user.passwordHash),
    setupCodeExpires: user.setupCodeHash ? user.setupCodeExpires : null,
    passwordSetAt: user.passwordSetAt,
  };
}

async function findOne(env, formula) {
  const params = new URLSearchParams({ filterByFormula: formula, maxRecords: '2' });
  const body = await airtableFetch(env, usersUrl(env, `?${params}`));
  const records = body.records || [];
  // Two rows with the same login is ambiguous - refuse rather than guess.
  return records.length === 1 ? toUser(records[0]) : null;
}

export async function findUserByEmail(env, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!isEmail(e)) return null;
  return findOne(env, `LOWER(TRIM({Email})) = ${formulaString(e)}`);
}

export async function findUserByFormCode(env, code) {
  if (!isFormCode(code)) return null;
  return findOne(env, `AND({Form Code} = ${formulaString(code)}, {Active})`);
}

export async function getUser(env, id) {
  return toUser(await airtableFetch(env, usersUrl(env, `/${id}`)));
}

export async function listUsers(env) {
  const users = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);
    const body = await airtableFetch(env, usersUrl(env, `?${params}`));
    for (const record of body.records || []) users.push(toUser(record));
    offset = body.offset;
  } while (offset && users.length < 500);
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createUser(env, { name, email, role, formCode }) {
  const record = await airtableFetch(env, usersUrl(env), {
    method: 'POST',
    body: JSON.stringify({ fields: { Name: name, Email: email, Role: ROLE_LABELS[role], Active: true, 'Form Code': formCode } }),
  });
  return toUser(record);
}

/** fields uses this module's keys: active, role, passwordHash, setupCodeHash, setupCodeExpires, passwordSetAt. */
export async function updateUser(env, id, fields) {
  const map = {
    active: ['Active', (v) => v === true],
    role: ['Role', (v) => ROLE_LABELS[v]],
    passwordHash: ['Password Hash', (v) => v || ''],
    setupCodeHash: ['Setup Code Hash', (v) => v || ''],
    setupCodeExpires: ['Setup Code Expires', (v) => v || null],
    passwordSetAt: ['Password Set At', (v) => v || null],
  };
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (map[key]) out[map[key][0]] = map[key][1](value);
  }
  const record = await airtableFetch(env, usersUrl(env, `/${id}`), { method: 'PATCH', body: JSON.stringify({ fields: out }) });
  return toUser(record);
}

/** A form code from the person's first name, made unique against existing codes. */
export function suggestFormCode(name, existingCodes) {
  const base = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().split(/\s+/)[0] || 'agent';
  const stem = base.slice(0, 24);
  const taken = new Set(existingCodes);
  if (!taken.has(stem)) return stem;
  for (let i = 2; i < 1000; i++) {
    if (!taken.has(`${stem}${i}`)) return `${stem}${i}`;
  }
  return `${stem}-${Date.now().toString(36)}`;
}
