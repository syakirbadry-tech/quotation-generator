/**
 * portalLink.js
 *
 * Connects this tool to the ASG Portal (Client-Form/admin). Both are
 * served from syakirbadry-tech.github.io, so when the agent opens the
 * tool from the portal in the same tab, the portal's sign-in (kept in
 * sessionStorage) is readable here - no second login.
 *
 * With `?vb=<prospect id>` in the address (the portal's VB and
 * Presentation pages link here that way), the tool shows who the
 * quotation is for and, after publishing, saves the quotation and story
 * links back onto that VB name (PATCH /admin/vb/:id, action "quote").
 *
 * Network: only the portal's own Worker API, with the signed-in agent's
 * token. Nothing from the PDF is sent here except the published links,
 * the product name and the monthly contribution.
 */

'use strict';

const API_BASE = 'https://prubsn-submission-service.syakirbadry.workers.dev';
const PORTAL_URL = 'https://syakirbadry-tech.github.io/Client-Form/admin/';
const SESSION_KEY = 'prubsn-admin-session'; // same key as Client-Form/admin/admin.js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!s || !s.token || !s.expiresAt || s.expiresAt * 1000 <= Date.now()) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function vbIdFromUrl(href) {
  try {
    const id = new URL(href).searchParams.get('vb') || '';
    return UUID_RE.test(id) ? id : null;
  } catch (e) {
    return null;
  }
}

async function call(session, path, method = 'GET', body) {
  const headers = { Authorization: `Bearer ${session.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit' });
  } catch (e) {
    throw new Error('Could not reach the portal. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `Portal request failed (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** The VB prospect this quotation is for, or null if it isn't the agent's. */
async function fetchProspect(session, vbId) {
  const { prospects } = await call(session, '/admin/vb');
  return prospects.find((p) => p.id === vbId) || null;
}

/** Save links (and optionally product / monthly) onto the VB prospect. */
async function saveQuoteLinks(session, vbId, { quoteUrl, storyUrl, product, monthly } = {}) {
  const body = { action: 'quote' };
  if (quoteUrl) body.quoteUrl = quoteUrl;
  if (storyUrl) body.storyUrl = storyUrl;
  if (product) body.product = product;
  if (Number.isFinite(monthly) && monthly > 0) body.monthly = monthly;
  const { prospect } = await call(session, `/admin/vb/${vbId}`, 'PATCH', body);
  return prospect;
}

/** The agent's personal client-form link (?agent=<form code>), or the plain form for the owner. */
function clientFormUrl(session) {
  const base = 'https://syakirbadry-tech.github.io/Client-Form/client-detail-form.html';
  const code = session && session.user && session.user.formCode;
  return code ? `${base}?agent=${encodeURIComponent(code)}` : base;
}

module.exports = { readSession, vbIdFromUrl, fetchProspect, saveQuoteLinks, clientFormUrl, PORTAL_URL };
