/**
 * publish.js
 *
 * Phase 9 - the public client quotation platform. This module is what
 * makes GET /q/:id and /app/:id possible at all: GitHub Pages (where the
 * agent's browser-tool itself is hosted) is a static host and cannot
 * serve a URL that didn't exist at build time, so a generated quotation
 * has to be handed to something that IS always running - this Worker,
 * backed by D1 - to get a real, stable public URL.
 *
 * Design choice: the browser renders the ENTIRE client document exactly
 * as it always has (parser -> renderNarrativeQuotationHtml ->
 * composeClientDocument, all unchanged) and hands the finished HTML
 * string to POST /publish, which stores it verbatim. This Worker never
 * re-implements rendering - there is exactly one renderer, and it lives
 * in the browser-tool bundle, not duplicated into a second (Workers)
 * JavaScript runtime. GET /q/:id therefore just plays the stored HTML
 * back, unchanged, indefinitely - a published quotation keeps looking
 * exactly as it did the day it was published even if the renderer is
 * later replaced again (see migrations/0001_create_quotations.sql).
 *
 * Trust boundary: POST /publish is, like /submit, a public endpoint with
 * no login system anywhere in this project (see worker.js's header
 * comment for why a baked-in "API key" wouldn't add real security here).
 * The one thing this module does insist on is that `generatedHtml`
 * actually contains this project's own renderer's `id="pq-doc"` marker -
 * a cheap, real check that rejects arbitrary unrelated content, even
 * though it can't stop a determined caller who copies real output. Rate
 * limiting (rateLimit.js, reused) and a small size cap are the other two
 * layers. This is a known, intentionally-scoped-out gap - there is no
 * per-agent authentication in this project at all yet - flagged in
 * PROJECT_STATUS.md, not silently assumed solved.
 */

export const MAX_PUBLISH_PAYLOAD_BYTES = 2 * 1024 * 1024; // a rendered quotation document is tens of KB, not MB - generous but not 20MB-generous
const UNIQUE_ID_ATTEMPTS = 5;
const RENDERER_MARKER = 'id="pq-doc"';

/**
 * Same transformation the browser-tool applies to a client's name for
 * display purposes, re-derived server-side rather than trusted from the
 * request - the Worker is the one thing guaranteeing every stored id is a
 * safe URL path segment, regardless of what a caller sends.
 */
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents after NFKD decomposition, e.g. "e" + U+0301 -> "e"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'client';
}

/** 8 lowercase-hex characters, e.g. "8f93cbe2" - collision-checked by the caller against D1, not assumed unique from randomness alone. */
export function generateUniqueId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

/**
 * @param {object} payload parsed JSON body of POST /publish
 * @returns {string|null} an error message, or null if the payload looks publishable
 */
export function validatePublishPayload(payload) {
  if (!payload.clientName || typeof payload.clientName !== 'string') {
    return 'Payload is missing clientName.';
  }
  if (!payload.generatedHtml || typeof payload.generatedHtml !== 'string') {
    return 'Payload is missing generatedHtml.';
  }
  if (!payload.generatedHtml.includes(RENDERER_MARKER)) {
    return 'generatedHtml does not look like a quotation this renderer produced.';
  }
  if (byteLength(payload.generatedHtml) > MAX_PUBLISH_PAYLOAD_BYTES) {
    return `generatedHtml is too large - maximum is ${Math.round(MAX_PUBLISH_PAYLOAD_BYTES / 1024 / 1024)}MB.`;
  }
  if (!payload.quotationJson || typeof payload.quotationJson !== 'object' || Array.isArray(payload.quotationJson)) {
    return 'Payload is missing quotationJson.';
  }
  if (!payload.rendererVersion || typeof payload.rendererVersion !== 'string') {
    return 'Payload is missing rendererVersion.';
  }
  return null;
}

/**
 * Inserts a new row, retrying with a fresh unique_id on the (extremely
 * rare) chance of a collision - D1's PRIMARY KEY constraint is the actual
 * source of truth for uniqueness, not the randomness alone.
 *
 * @returns {Promise<{ id: string, uniqueId: string, generatedDate: string }>}
 */
export async function insertQuotation(db, record) {
  let lastErr;
  for (let attempt = 0; attempt < UNIQUE_ID_ATTEMPTS; attempt++) {
    const uniqueId = generateUniqueId();
    const id = `${record.slug}-${uniqueId}`;
    const generatedDate = new Date().toISOString();
    try {
      await db
        .prepare(
          `INSERT INTO quotations
            (id, slug, unique_id, client_name, plan, monthly_total_payable, annual_contribution, application_status, renderer_version, quotation_json, generated_html, generated_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          record.slug,
          uniqueId,
          record.clientName,
          record.plan || null,
          record.monthlyTotalPayable || null,
          record.annualContribution || null,
          'Not Started',
          record.rendererVersion,
          JSON.stringify(record.quotationJson),
          record.generatedHtml,
          generatedDate
        )
        .run();
      return { id, uniqueId, generatedDate };
    } catch (err) {
      lastErr = err;
      // Only retry on an actual uniqueness collision - anything else (a
      // genuine DB error) should surface immediately, not be masked by
      // retrying the same failing insert five times.
      if (!/unique/i.test(err && err.message || '')) throw err;
    }
  }
  throw lastErr || new Error('Could not generate a unique quotation id.');
}

/** @returns {Promise<object|null>} the stored row, or null if `id` doesn't exist */
export async function getQuotationById(db, id) {
  if (!id) return null;
  return db.prepare(`SELECT * FROM quotations WHERE id = ?`).bind(id).first();
}

export function notFoundHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quotation Not Found</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#0B2545;text-align:center}
  h1{font-size:22px;margin-bottom:12px}
  p{color:#5A6B85;font-size:15px;line-height:1.6}
</style>
<h1>This link doesn't lead anywhere</h1>
<p>The quotation you're looking for doesn't exist, or the link may have been typed incorrectly. Please check the link your agent sent you, or contact them directly.</p>
`;
}
