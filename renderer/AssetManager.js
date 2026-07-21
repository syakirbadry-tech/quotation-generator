/**
 * AssetManager.js
 *
 * The ONLY thing in this project that knows an image's filename. The
 * renderer never hardcodes a path - it calls a function here
 * (`getHeroImage()`, `getPlanImage(planTier)`, etc.) and always gets
 * back a usable URL: real image if configured, otherwise a fallback,
 * down to a site-wide `default.jpg` - never `null`, never a crash.
 * Whether that URL's file actually exists on disk yet is a separate
 * concern, handled at the renderer's call site via each `<img>`'s own
 * `onerror` fallback to a placeholder panel - see
 * renderNarrativeQuotation.js's `imageWithFallback()`. That two-layer
 * design is deliberate: this module always resolves to *some* path (so
 * "no image configured" and "image configured but file not uploaded
 * yet" are handled the same simple way), while the actual browser never
 * shows a broken-image icon even when nothing has been uploaded at all.
 *
 *   Renderer  ->  AssetManager  ->  image-manifest.json  ->  a real file
 *
 * See browser-tool/assets/images/README.md for the full picture
 * (folder layout, how to add a new image with zero code changes, sizing
 * guidance for whoever supplies the actual photography).
 *
 * --- Lookup / fallback order, for a keyed category (plans, coverage, roomBoard) ---
 *   1. `manifest[category][key]` - the exact match (e.g. plans["200"])
 *   2. `manifest[category].default` - a generic image for that whole category
 *   3. `manifest.misc.default` if set, else the site-wide `BASE_PATH + 'default.jpg'`
 * A step 2 or 3 fallback logs a console.warn naming the category/key that
 * missed, so a gap is visible during agent review, never silently wrong
 * in front of a client. Step 1 landing exactly never warns.
 *
 * --- Lookup order for a single-image category (hero, hospital, accident,
 * surgery, recovery, financial, waitingPeriod, cashValue, guarantee) ---
 *   1. `manifest[category].default`
 *   2. the site-wide default (with a warning)
 *
 * --- Why URLs, not require()-embedded image data ---
 * Images are referenced as URLs (not inlined/bundled) because a single
 * generated quotation document can end up viewed from three different
 * origins: the agent's own browser-tool preview iframe, a downloaded
 * standalone .html file opened directly, and a page served from the
 * Cloudflare Worker's completely different domain once published (see
 * backend/src/publish.js). BASE_PATH must therefore be an absolute URL
 * once real images exist - see its own comment below.
 */

'use strict';

const manifest = require('../browser-tool/assets/images/image-manifest.json');

/**
 * Where the images physically live once deployed. Left empty (relative
 * paths) during local development and testing; set to the real,
 * absolute GitHub Pages base URL before images actually go live, so a
 * published quotation (served from an entirely different Worker domain)
 * still resolves them correctly. Never a build-time secret - this is
 * just the public asset host.
 *
 * Example once real images exist:
 *   const BASE_PATH = 'https://syakirbadry-tech.github.io/quotation-generator/assets/images/';
 */
const BASE_PATH = '';

const DEFAULT_IMAGE_PATH = 'default.jpg';

function resolveUrl(relativePath) {
  return `${BASE_PATH}assets/images/${relativePath}`;
}

/** Strips everything but digits, e.g. "RM1,200,000" -> "1200000", "RM200 per day" -> "200". Returns null (never "") for a value with no digits at all, so callers can tell "no usable key" apart from a real, if unusual, "0". */
function numericKey(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  return digits || null;
}

function siteWideDefault(category, key) {
  console.warn(`AssetManager: no image configured for category "${category}"${key ? `, key "${key}"` : ''} - falling back to the site-wide default.`);
  const miscDefault = manifest.misc && manifest.misc.default;
  return miscDefault ? resolveUrl(miscDefault) : resolveUrl(DEFAULT_IMAGE_PATH);
}

/**
 * @returns {string} always a usable URL - falls all the way to the
 *   site-wide default.jpg rather than ever returning null, per the
 *   "do not crash, use default.jpg, log a warning" requirement. Whether
 *   that URL actually loads (nothing is checked against disk at
 *   render time - this is a static-hosted asset, not a server that could
 *   check first) is handled at the renderer call site via the <img>'s
 *   own onerror fallback to a placeholder panel - see
 *   renderNarrativeQuotation.js's imageWithFallback().
 */
function lookupSingle(category) {
  const entry = manifest[category] && manifest[category].default;
  if (entry) return resolveUrl(entry);
  return siteWideDefault(category, null);
}

/** @returns {string} same contract as lookupSingle, for a category keyed by product data */
function lookupKeyed(category, rawKey) {
  const key = numericKey(rawKey);
  const categoryMap = manifest[category] || {};
  if (key && categoryMap[key]) return resolveUrl(categoryMap[key]);
  if (categoryMap.default) {
    if (key) console.warn(`AssetManager: no image configured for category "${category}", key "${key}" - using that category's default image instead.`);
    return resolveUrl(categoryMap.default);
  }
  return siteWideDefault(category, key);
}

function getHeroImage() { return lookupSingle('hero'); }
/** @param {string|number} planTier e.g. data.plan.medicalPlanTier ("Plan 200") or a bare number - only the digits are used */
function getPlanImage(planTier) { return lookupKeyed('plans', planTier); }
/** @param {string|number} annualLimit e.g. data.benefits.annualLimit ("RM200,000") or a bare number */
function getCoverageImage(annualLimit) { return lookupKeyed('coverage', annualLimit); }
/** @param {string|number} roomBoardRate e.g. a benefit item's value ("RM200 per day") or a bare number */
function getRoomBoardImage(roomBoardRate) { return lookupKeyed('roomBoard', roomBoardRate); }
function getHospitalImage() { return lookupSingle('hospital'); }
function getAccidentImage() { return lookupSingle('accident'); }
function getSurgeryImage() { return lookupSingle('surgery'); }
function getRecoveryImage() { return lookupSingle('recovery'); }
function getFinancialImage() { return lookupSingle('financial'); }
function getWaitingPeriodImage() { return lookupSingle('waitingPeriod'); }
function getCashValueImage() { return lookupSingle('cashValue'); }
function getGuaranteeImage() { return lookupSingle('guarantee'); }
/** @param {string} key any free-form key under the "misc" category */
function getMiscImage(key) { return lookupKeyed('misc', key); }

module.exports = {
  getHeroImage,
  getPlanImage,
  getCoverageImage,
  getRoomBoardImage,
  getHospitalImage,
  getAccidentImage,
  getSurgeryImage,
  getRecoveryImage,
  getFinancialImage,
  getWaitingPeriodImage,
  getCashValueImage,
  getGuaranteeImage,
  getMiscImage,
  // Exposed for tests only - not part of the intended public surface.
  _numericKey: numericKey,
  _resolveUrl: resolveUrl,
};
