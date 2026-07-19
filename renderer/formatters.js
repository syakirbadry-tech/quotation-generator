/**
 * formatters.js
 *
 * Pure presentation helpers for the renderer. Everything here operates on
 * ALREADY-EXTRACTED data (numbers, ISO date strings, short label
 * strings) - formatting them for display is not PDF parsing and doesn't
 * belong in the frozen parser. Nothing in this file reads a PDF, and
 * nothing in the parser should ever import this file.
 */

'use strict';

/** Basic HTML-escaping for any text that ultimately came from a PDF/PDF-derived string. */
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 176 -> "176", 2112.5 -> "2,112.50" */
function formatMoney(n) {
  if (n == null || !Number.isFinite(n)) return null;
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString('en-MY', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** "2026-07-14" -> "14 July 2026" */
function formatDateLong(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * A benefit-item value string like "RM200 per day (maximum 150 days per
 * rider year)" carries a lot of detail for a compact summary card. This
 * trims it to the part before the first parenthetical note. Presentation
 * only - the full string is still used wherever there's room for it
 * (e.g. the benefits table).
 */
function shortValue(value) {
  if (!value) return null;
  return value.split('(')[0].trim();
}

/** Pulls the leading digits out of a co-payment option label, e.g. "SmartSaver300" -> "300". */
function coPaymentAmount(coPaymentOption) {
  if (!coPaymentOption) return null;
  const m = String(coPaymentOption).match(/[\d,]+/);
  return m ? m[0] : null;
}

/**
 * Tightens a benefit value like "RM200 per day" into the terser
 * "RM 200/day" style used on the compact medical-card mockup, which has
 * a fixed aspect ratio and no room for the fuller wording used elsewhere
 * on the page.
 */
function compactRate(value) {
  if (!value) return null;
  return shortValue(value)
    .replace(/^RM\s*/i, 'RM ')
    .replace(/\s*per\s*rider\s*year\b/i, '/yr')
    .replace(/\s*per\s*year\b/i, '/yr')
    .replace(/\s*per\s*day\b/i, '/day');
}

/**
 * A benefit item's extracted value can be a long joined blob - the
 * bounded-slice extraction technique in the parser deliberately keeps
 * every non-label line in a table cell's range (bullet sub-items,
 * day-count notes, "including:" prose) rather than guessing which part
 * is "the real value". That's the right call for a data layer, but a
 * compact summary table needs just the headline figure/phrase. This
 * pulls out the first strong value-shaped token (an RM amount with its
 * unit, "As charged", "Yes", or a "No ... Limit" phrase) and leaves the
 * rest out of the compact table cell - nothing here changes what the
 * parser extracted, only what's displayed in this one narrow column.
 */
function primaryValue(value) {
  if (!value) return null;
  // Deliberately NOT case-insensitive: "RM" and "per" are always printed
  // in this exact case in the source PDF, and keeping the "per <unit>"
  // continuation match restricted to lowercase means it naturally stops
  // at the next capitalised word (a bullet/label bleeding in from the
  // rest of the joined cell) without needing a lookahead.
  const rmMatch = value.match(/RM\s*[\d,]+(\.\d+)?(\s+per\s+[a-z]+(\s+[a-z]+)?)?/);
  if (rmMatch) return rmMatch[0].replace(/\s+/g, ' ').trim();
  if (/As charged/i.test(value)) return 'As charged';
  if (/^\s*Yes\s*$/i.test(value)) return 'Yes';
  if (/No Lifetime Limit/i.test(value)) return 'No Lifetime Limit';
  if (/No Limit/i.test(value)) return 'No Limit';
  return shortValue(value) || null;
}

/** "Plan 200" -> "200" - for compact contexts that already say the rider name. */
function bareTierNumber(planTier) {
  if (!planTier) return null;
  return planTier.replace(/^Plan\s+/i, '');
}

module.exports = {
  escapeHtml,
  formatMoney,
  formatDateLong,
  shortValue,
  coPaymentAmount,
  compactRate,
  bareTierNumber,
  primaryValue,
};
