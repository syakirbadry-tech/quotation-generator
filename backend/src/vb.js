/**
 * vb.js
 *
 * /admin/vb - the portal's VB (prospect pipeline) for every signed-in
 * person. Stages:
 *   VB1 new name -> VB2 contacted -> VB3 appointment -> VB4 policy approved
 * VB4 is keyed in by the agent (we have no access to Prudential's systems)
 * with the product, premium and frequency, from which TPC (annual
 * contribution) and the contest case value are worked out.
 *
 * Privacy rule: each person only ever sees their own prospects' names.
 * Leaders and the owner additionally get per-agent COUNTS, never names.
 *
 * Stored in the QUOTATIONS_DB D1 database (tables created on first use,
 * see SCHEMA - also in migrations/0002_create_vb.sql for reference).
 */

export const STAGES = [1, 2, 3, 4];
export const PAYMENTS_PER_YEAR = { Monthly: 12, Quarterly: 4, 'Half-yearly': 2, Yearly: 1 };
// A policy with TPC of at least this counts as one contest case; anything below counts as half.
export const FULL_CASE_TPC = 1800;
const MAX_PROSPECTS_LISTED = 2000;
const MAX_TEXT = { name: 100, phone: 30, source: 60, note: 1000, product: 100 };
const MY_OFFSET_MS = 8 * 3600 * 1000; // Malaysia is UTC+8 all year

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS vb_prospects (
    id             TEXT PRIMARY KEY,
    owner_email    TEXT NOT NULL,
    owner_name     TEXT NOT NULL,
    name           TEXT NOT NULL,
    phone          TEXT NOT NULL DEFAULT '',
    source         TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    stage          INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL,
    contacted_at   TEXT,
    appointment_at TEXT,
    approved_at    TEXT,
    product        TEXT,
    premium        REAL,
    frequency      TEXT,
    tpc            REAL,
    cases          REAL,
    updated_at     TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_vb_prospects_owner ON vb_prospects(owner_email)',
];

const ready = new WeakMap();
function ensureSchema(db) {
  if (!ready.has(db)) {
    const p = db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => { ready.delete(db); throw err; });
    ready.set(db, p);
  }
  return ready.get(db);
}

export function tpcOf(premium, frequency) {
  return Math.round(Number(premium) * PAYMENTS_PER_YEAR[frequency] * 100) / 100;
}

export function casesOf(tpc) {
  return tpc >= FULL_CASE_TPC ? 1 : 0.5;
}

/** Monday 00:00 Malaysia time of the week containing `now`, as a UTC ISO string, plus the next Monday. */
export function weekRange(now = new Date()) {
  const my = new Date(now.getTime() + MY_OFFSET_MS);
  const daysSinceMonday = (my.getUTCDay() + 6) % 7;
  const start = Date.UTC(my.getUTCFullYear(), my.getUTCMonth(), my.getUTCDate() - daysSinceMonday) - MY_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + 7 * 86400000).toISOString() };
}

function text(value, key) {
  const v = String(value ?? '');
  // Notes keep their line breaks; everything else is one tidy line.
  return (key === 'note' ? v.replace(/\r\n?/g, '\n') : v.replace(/\s+/g, ' ')).trim().slice(0, MAX_TEXT[key]);
}

function toProspect(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    source: row.source,
    note: row.note,
    stage: row.stage,
    createdAt: row.created_at,
    contactedAt: row.contacted_at,
    appointmentAt: row.appointment_at,
    approvedAt: row.approved_at,
    product: row.product,
    premium: row.premium,
    frequency: row.frequency,
    tpc: row.tpc,
    cases: row.cases,
  };
}

// How many names reached each stage during the week (by the date they reached it;
// VB3 counts in the week the appointment itself is on).
const WEEK_COUNTS = `
  SUM(CASE WHEN created_at     >= ?1 AND created_at     < ?2 THEN 1 ELSE 0 END) AS vb1,
  SUM(CASE WHEN contacted_at   >= ?1 AND contacted_at   < ?2 THEN 1 ELSE 0 END) AS vb2,
  SUM(CASE WHEN appointment_at >= ?1 AND appointment_at < ?2 THEN 1 ELSE 0 END) AS vb3,
  SUM(CASE WHEN approved_at    >= ?1 AND approved_at    < ?2 THEN 1 ELSE 0 END) AS vb4,
  SUM(CASE WHEN approved_at    >= ?1 AND approved_at    < ?2 THEN cases ELSE 0 END) AS cases,
  SUM(CASE WHEN approved_at    >= ?1 AND approved_at    < ?2 THEN tpc ELSE 0 END) AS tpc`;

function counts(row) {
  const r = row || {};
  return { vb1: r.vb1 || 0, vb2: r.vb2 || 0, vb3: r.vb3 || 0, vb4: r.vb4 || 0, cases: r.cases || 0, tpc: r.tpc || 0 };
}

async function overview(db, viewer, now) {
  const week = weekRange(now);
  const { results } = await db.prepare(
    `SELECT * FROM vb_prospects WHERE owner_email = ? ORDER BY updated_at DESC LIMIT ${MAX_PROSPECTS_LISTED}`
  ).bind(viewer.email).all();
  const mine = await db.prepare(`SELECT ${WEEK_COUNTS} FROM vb_prospects WHERE owner_email = ?3`)
    .bind(week.start, week.end, viewer.email).first();
  const body = { prospects: results.map(toProspect), week: { ...week, counts: counts(mine) }, team: null };

  if (viewer.seesAll) {
    // Counts only - this query never selects a prospect's name or phone.
    const team = await db.prepare(
      `SELECT owner_email, MAX(owner_name) AS agent,
         SUM(CASE WHEN stage = 1 THEN 1 ELSE 0 END) AS open1,
         SUM(CASE WHEN stage = 2 THEN 1 ELSE 0 END) AS open2,
         SUM(CASE WHEN stage = 3 THEN 1 ELSE 0 END) AS open3,
         SUM(CASE WHEN stage = 4 THEN 1 ELSE 0 END) AS open4,
         ${WEEK_COUNTS}
       FROM vb_prospects GROUP BY owner_email ORDER BY agent`
    ).bind(week.start, week.end).all();
    body.team = team.results.map((r) => ({
      agent: r.agent,
      byStage: { vb1: r.open1 || 0, vb2: r.open2 || 0, vb3: r.open3 || 0, vb4: r.open4 || 0 },
      week: counts(r),
    }));
  }
  return body;
}

function validTime(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Handles /admin/vb and /admin/vb/:id for an already signed-in viewer.
 * `h` carries admin.js's response helpers so CORS and errors stay identical.
 */
export async function handleVb(request, env, path, viewer, h, now = new Date()) {
  const { json, fail, readJsonBody } = h;
  const db = env.QUOTATIONS_DB;
  if (!db) return fail('VB is not set up yet.', 'not_configured', 503, env);
  await ensureSchema(db);
  const nowIso = now.toISOString();

  if (path === '/admin/vb') {
    if (request.method === 'GET') return json({ success: true, ...(await overview(db, viewer, now)) }, 200, env);
    if (request.method !== 'POST') return fail('Method not allowed.', 'method_not_allowed', 405, env);
    const { body, error } = await readJsonBody(request, env);
    if (error) return error;
    const name = text(body.name, 'name');
    if (!name) return fail('Please enter a name.', 'invalid_name', 400, env);
    const row = {
      id: crypto.randomUUID(), name,
      phone: text(body.phone, 'phone'), source: text(body.source, 'source'), note: text(body.note, 'note'),
    };
    await db.prepare(
      `INSERT INTO vb_prospects (id, owner_email, owner_name, name, phone, source, note, stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(row.id, viewer.email, viewer.name || viewer.email, row.name, row.phone, row.source, row.note, nowIso, nowIso).run();
    const created = await db.prepare('SELECT * FROM vb_prospects WHERE id = ?').bind(row.id).first();
    return json({ success: true, prospect: toProspect(created) }, 201, env);
  }

  const id = path.slice('/admin/vb/'.length);
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail('Not found.', 'not_found', 404, env);
  // Owner check is part of every query: someone else's id behaves exactly like a missing one.
  const current = await db.prepare('SELECT * FROM vb_prospects WHERE id = ? AND owner_email = ?').bind(id, viewer.email).first();
  if (!current) return fail('Not found.', 'not_found', 404, env);

  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM vb_prospects WHERE id = ? AND owner_email = ?').bind(id, viewer.email).run();
    return json({ success: true }, 200, env);
  }
  if (request.method !== 'PATCH') return fail('Method not allowed.', 'method_not_allowed', 405, env);

  const { body, error } = await readJsonBody(request, env);
  if (error) return error;
  const set = {};
  switch (body.action) {
    case 'edit': {
      for (const key of ['name', 'phone', 'source', 'note']) {
        if (body[key] !== undefined) set[key] = text(body[key], key);
      }
      if (set.name === '') return fail('Please enter a name.', 'invalid_name', 400, env);
      break;
    }
    case 'contacted':
      set.contacted_at = current.contacted_at || nowIso;
      set.stage = Math.max(current.stage, 2);
      break;
    case 'appointment': {
      const at = validTime(body.at);
      if (!at) return fail('Please choose the appointment date and time.', 'invalid_time', 400, env);
      set.appointment_at = at;
      set.contacted_at = current.contacted_at || nowIso;
      set.stage = Math.max(current.stage, 3);
      break;
    }
    case 'approved': {
      const premium = Number(body.premium);
      if (!(premium > 0 && premium <= 1000000)) return fail('Please enter the premium.', 'invalid_premium', 400, env);
      if (!PAYMENTS_PER_YEAR[body.frequency]) return fail('Please choose how often it is paid.', 'invalid_frequency', 400, env);
      const product = text(body.product, 'product');
      if (!product) return fail('Please enter the product.', 'invalid_product', 400, env);
      const tpc = tpcOf(premium, body.frequency);
      Object.assign(set, {
        product, premium, frequency: body.frequency, tpc, cases: casesOf(tpc), stage: 4,
        approved_at: current.approved_at || nowIso, contacted_at: current.contacted_at || nowIso,
      });
      break;
    }
    default:
      return fail('Unknown action.', 'invalid_action', 400, env);
  }
  set.updated_at = nowIso;
  const columns = Object.keys(set);
  await db.prepare(`UPDATE vb_prospects SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND owner_email = ?`)
    .bind(...columns.map((c) => set[c]), id, viewer.email).run();
  const updated = await db.prepare('SELECT * FROM vb_prospects WHERE id = ?').bind(id).first();
  return json({ success: true, prospect: toProspect(updated) }, 200, env);
}
