/**
 * answers.js
 *
 * Presentation answers - the choices a client taps during an agent's
 * story presentation (the GitHub Pages decks in prubsn-presentations),
 * e.g. "Biggest worries: Cancer, Heart attack", "Monthly budget: RM200-300".
 *
 *   POST /presentation-answers              public, from the client's own browser
 *   GET  /admin/presentation-answers        signed-in list (see admin.js)
 *   DELETE /admin/presentation-answers/:id  signed-in delete
 *
 * Privacy rule: this endpoint is for tapped preferences only. It never
 * accepts IC numbers, bank or card numbers or anything else that belongs
 * in the application form - any long run of digits is refused outright,
 * so a client typing their IC into a free-text box can't leak it here.
 *
 * Like /submit, there is no API key: anything baked into a public page
 * is visible to everyone, so it would add no real security. Abuse is
 * limited by size caps, strict shape validation and the optional rate
 * limit instead.
 *
 * Stored in the QUOTATIONS_DB D1 database (table created on first use,
 * also in migrations/0003_create_presentation_answers.sql for reference).
 */

import { addMissingColumns } from './schemaColumns.js';

const MAX_BODY_BYTES = 8 * 1024;
const MAX_KEYS = 20;
const MAX_ARRAY = 12;
const MAX_VALUE = 200;
const MAX_LINES = 20;
const MAX_LINE = 300;
const MAX_LISTED = 300;
const SENDS_PER_MINUTE = 10;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;
// 10+ digits in a row, allowing spaces or dashes between them: IC (12), bank and card numbers.
const LONG_NUMBER_RE = /\d(?:[\s-]?\d){9,}/;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS presentation_answers (
    id           TEXT PRIMARY KEY,
    created_at   TEXT NOT NULL,
    client       TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT '',
    agent_email  TEXT NOT NULL DEFAULT '',
    agent_name   TEXT NOT NULL DEFAULT '',
    answers_json TEXT NOT NULL,
    summary_json TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_presentation_answers_agent ON presentation_answers(agent_email)',
];

// Added later: the VB prospect a deck was made for (from the Quotation Generator).
const LATER_COLUMNS = [['vb_id', "TEXT NOT NULL DEFAULT ''"]];

const ready = new WeakMap();
function ensureSchema(db) {
  if (!ready.has(db)) {
    const p = db.batch(SCHEMA.map((sql) => db.prepare(sql)))
      .then(() => addMissingColumns(db, 'presentation_answers', LATER_COLUMNS))
      .catch((err) => { ready.delete(db); throw err; });
    ready.set(db, p);
  }
  return ready.get(db);
}

const tidy = (v) => String(v).replace(/\s+/g, ' ').trim();

/** Returns { value } with the cleaned payload, or { error } with a client-safe message. */
export function validateAnswers(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Expected a JSON object.' };
  const client = typeof body.client === 'string' ? tidy(body.client) : '';
  if (!client || client.length > 100) return { error: 'client must be a name of 1-100 characters.' };
  const source = body.source === undefined ? '' : (typeof body.source === 'string' ? tidy(body.source) : null);
  if (source === null || source.length > 80) return { error: 'source must be text of up to 80 characters.' };
  const agentCode = typeof body.agentCode === 'string' ? body.agentCode.trim() : '';
  // Only a tag for the agent's own VB page; a wrong id simply matches nothing.
  const vbId = typeof body.vbId === 'string' && /^[0-9a-f-]{36}$/.test(body.vbId) ? body.vbId : '';

  const raw = body.answers;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'answers must be an object.' };
  const keys = Object.keys(raw);
  if (!keys.length) return { error: 'answers is empty.' };
  if (keys.length > MAX_KEYS) return { error: `answers can have at most ${MAX_KEYS} entries.` };
  const answers = {};
  for (const key of keys) {
    if (!KEY_RE.test(key)) return { error: `answers has an invalid key: ${key.slice(0, 30)}` };
    const v = raw[key];
    const list = Array.isArray(v) ? v : [v];
    if (list.length > MAX_ARRAY) return { error: `answers.${key} has too many items.` };
    const clean = [];
    for (const item of list) {
      if (typeof item !== 'string' && typeof item !== 'number') return { error: `answers.${key} must be text.` };
      const t = tidy(item);
      if (t.length > MAX_VALUE) return { error: `answers.${key} is too long.` };
      if (t) clean.push(t);
    }
    if (clean.length) answers[key] = Array.isArray(v) ? clean : clean[0];
  }
  if (!Object.keys(answers).length) return { error: 'answers is empty.' };

  const rawLines = body.summary === undefined ? [] : body.summary;
  if (!Array.isArray(rawLines) || rawLines.length > MAX_LINES) return { error: `summary must be a list of up to ${MAX_LINES} lines.` };
  const summary = [];
  for (const line of rawLines) {
    if (typeof line !== 'string') return { error: 'summary lines must be text.' };
    const t = tidy(line);
    if (t.length > MAX_LINE) return { error: 'A summary line is too long.' };
    if (t) summary.push(t);
  }

  const everything = [client, source, ...summary, ...Object.values(answers).flat()];
  if (everything.some((t) => LONG_NUMBER_RE.test(t))) {
    return { error: 'Please leave out IC, bank or card numbers - those go in the application form only.' };
  }
  return { value: { client, source, agentCode, vbId, answers, summary } };
}

function toAnswer(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    client: row.client,
    source: row.source,
    agentName: row.agent_name,
    agentEmail: row.agent_email,
    answers: JSON.parse(row.answers_json),
    summary: JSON.parse(row.summary_json),
    vbId: row.vb_id || null,
  };
}

/**
 * POST /presentation-answers. `helpers` comes from worker.js so this
 * shares its CORS, JSON error shape, rate limiter and agent lookup.
 */
export async function handlePublicAnswers(request, env, { json, fail, clientIp, checkRateLimit, lookupAgent }) {
  if (request.method !== 'POST') return fail('Method not allowed - use POST.', 'method_not_allowed', 405, env);
  if (!env.QUOTATIONS_DB) {
    console.error('Worker misconfigured - missing QUOTATIONS_DB D1 binding');
    return fail('Answer saving is not configured.', 'not_configured', 500, env);
  }
  // text/plain is accepted too: it skips the CORS preflight, which some in-app browsers handle badly.
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.includes('application/json') && !type.includes('text/plain')) {
    return fail('Content-Type must be application/json.', 'invalid_content_type', 400, env);
  }
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) return fail('Payload too large.', 'payload_too_large', 413, env);

  const rl = await checkRateLimit(env.RATE_LIMIT_KV, `answers:${clientIp}`, SENDS_PER_MINUTE);
  if (rl.limited) return fail('Too many sends from this connection - please wait a minute and try again.', 'rate_limited', 429, env);

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail('Payload too large.', 'payload_too_large', 413, env);
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    return fail('Body is not valid JSON.', 'invalid_json', 400, env);
  }
  const { value, error } = validateAnswers(body);
  if (error) return fail(error, 'invalid_payload', 400, env);

  const agent = value.agentCode ? await lookupAgent(env, value.agentCode) : null;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await ensureSchema(env.QUOTATIONS_DB);
  await env.QUOTATIONS_DB.prepare(
    'INSERT INTO presentation_answers (id, created_at, client, source, agent_email, agent_name, answers_json, summary_json, vb_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, createdAt, value.client, value.source, (agent && agent.email) || '', (agent && agent.name) || '', JSON.stringify(value.answers), JSON.stringify(value.summary), value.vbId).run();
  return json({ success: true, id, createdAt }, 200, env);
}

/** /admin/presentation-answers[/:id] for a signed-in viewer. Owner and leaders see everything; agents see answers sent from their own links. */
export async function handleAdminAnswers(request, env, path, viewer, { json, fail }) {
  if (!env.QUOTATIONS_DB) return fail('Answer saving is not configured.', 'not_configured', 500, env);
  const db = env.QUOTATIONS_DB;
  await ensureSchema(db);

  if (path === '/admin/presentation-answers') {
    if (request.method !== 'GET') return fail('Method not allowed - use GET.', 'method_not_allowed', 405, env);
    const stmt = viewer.seesAll
      ? db.prepare(`SELECT * FROM presentation_answers ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_LISTED}`)
      : db.prepare(`SELECT * FROM presentation_answers WHERE agent_email = ? ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_LISTED}`).bind(viewer.email);
    const { results } = await stmt.all();
    return json({ success: true, answers: results.map(toAnswer) }, 200, env);
  }

  const id = path.slice('/admin/presentation-answers/'.length);
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail('Not found.', 'not_found', 404, env);
  if (request.method !== 'DELETE') return fail('Method not allowed - use DELETE.', 'method_not_allowed', 405, env);
  const row = await db.prepare('SELECT agent_email FROM presentation_answers WHERE id = ?').bind(id).first();
  if (!row || (!viewer.seesAll && row.agent_email !== viewer.email)) return fail('Not found.', 'not_found', 404, env);
  await db.prepare('DELETE FROM presentation_answers WHERE id = ?').bind(id).run();
  return json({ success: true }, 200, env);
}
