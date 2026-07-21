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

/**
 * Always exactly 2 decimal places - 176 -> "176.00", 2112.5 -> "2,112.50".
 * Reserved for "Monthly Total Amount Payable" (the PruBSN Product
 * Illustration's own term for this figure), which must render as
 * "RM 246.00" everywhere it appears, never "RM246", "RM 246", "246", or
 * "RM 246/mo" - formatMoney()'s variable decimal count (it drops ".00"
 * for whole numbers) is the wrong tool for this one specific figure.
 */
function formatMoneyFixed2(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Resolves "Monthly Total Amount Payable". Priority 1 is always the
 * PDF's own printed figure (contributions.totalMonthlyContribution - a
 * Required, directly-extracted field per docs/PARSER_API.md, never
 * computed by the parser itself). Only falls back to deriving it from
 * the annual figure (divided by 12, rounded to 2dp) when the primary field is
 * genuinely absent - e.g. a malformed source document - matching the
 * same "derive only when the real value is missing, and only when
 * mathematically safe" rule already used for plan.coverageToAge's
 * fallback in parseQuotation.js. Returns a number (or null if neither
 * source is available) - callers format it with formatMoneyFixed2().
 */
function resolveMonthlyTotalPayable(contributions) {
  const c = contributions || {};
  if (c.totalMonthlyContribution != null && Number.isFinite(c.totalMonthlyContribution)) {
    return c.totalMonthlyContribution;
  }
  if (c.totalAnnualContribution != null && Number.isFinite(c.totalAnnualContribution)) {
    return Math.round((c.totalAnnualContribution / 12) * 100) / 100;
  }
  return null;
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
 * strips the parenthetical day-count note(s) out, keeping just the
 * headline figure. Presentation only - the full string is still used
 * wherever there's room for it (e.g. the benefits table).
 *
 * Strips every parenthetical group, not just text before the first "(" -
 * a real source value can carry the note BEFORE the figure too (e.g.
 * "(maximum 150 days per rider year) RM200 per day", seen in the
 * synthetic test fixture), and taking only the text before the first "("
 * silently returned an empty string for those, making the Room & Board
 * key-figure card and medical-card mockup fall back to "Refer to
 * certificate" even though the benefits table right below it, which
 * extracts the same value with a different helper (primaryValue), showed
 * the real figure.
 *
 * When a value is NOTHING but a parenthetical note (e.g. the ICU/CCU row
 * described in docs/KNOWN_LIMITATIONS.md item 2, whose only extracted
 * text is "(maximum 150 days per rider year)" - the real "As charged"
 * token sits on a neighbouring merged cell), stripping parens leaves an
 * empty string, and this correctly returns null rather than falling back
 * to the raw parenthetical text - a bare day-count note is not a real
 * coverage figure and must still hit the caller's "missing" treatment,
 * not be displayed as if it were data.
 */
function shortValue(value) {
  if (!value) return null;
  const stripped = value.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped || null;
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
  formatMoneyFixed2,
  resolveMonthlyTotalPayable,
  formatDateLong,
  shortValue,
  coPaymentAmount,
  compactRate,
  bareTierNumber,
  primaryValue,
};
