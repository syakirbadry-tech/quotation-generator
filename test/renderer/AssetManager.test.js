/**
 * AssetManager.test.js
 *
 * Tests renderer/AssetManager.js against the REAL, committed
 * image-manifest.json (currently empty categories - no production
 * images exist yet), so these tests double as a live check that every
 * function gracefully falls back to the site-wide default rather than
 * ever throwing or returning something unusable.
 *
 * Usage: node test/renderer/AssetManager.test.js
 */

'use strict';

const assert = require('assert');
const AssetManager = require('../../renderer/AssetManager');

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`  PASS  ${label}`);
    pass++;
  } catch (err) {
    console.log(`  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}
function ok(label, condition) {
  check(label, Boolean(condition), true);
}

console.log('=== _numericKey ===');
{
  check('strips commas/currency, keeps digits', AssetManager._numericKey('RM1,200,000'), '1200000');
  check('strips a trailing unit', AssetManager._numericKey('RM200 per day'), '200');
  check('a bare number is stringified', AssetManager._numericKey(200), '200');
  check('no digits at all resolves to null, not an empty string', AssetManager._numericKey('As charged'), null);
  check('null input resolves to null', AssetManager._numericKey(null), null);
  check('undefined input resolves to null', AssetManager._numericKey(undefined), null);
}

console.log('\n=== Every getter returns a usable URL against the current (empty) manifest ===');
{
  const originalWarn = console.warn;
  console.warn = () => {}; // expected/intentional warnings in this section - keep test output clean

  const getters = [
    ['getHeroImage', () => AssetManager.getHeroImage()],
    ['getPlanImage("Plan 200")', () => AssetManager.getPlanImage('Plan 200')],
    ['getCoverageImage("RM200,000")', () => AssetManager.getCoverageImage('RM200,000')],
    ['getRoomBoardImage("RM200 per day")', () => AssetManager.getRoomBoardImage('RM200 per day')],
    ['getHospitalImage', () => AssetManager.getHospitalImage()],
    ['getAccidentImage', () => AssetManager.getAccidentImage()],
    ['getSurgeryImage', () => AssetManager.getSurgeryImage()],
    ['getRecoveryImage', () => AssetManager.getRecoveryImage()],
    ['getFinancialImage', () => AssetManager.getFinancialImage()],
    ['getWaitingPeriodImage', () => AssetManager.getWaitingPeriodImage()],
    ['getCashValueImage', () => AssetManager.getCashValueImage()],
    ['getGuaranteeImage', () => AssetManager.getGuaranteeImage()],
    ['getMiscImage("anything")', () => AssetManager.getMiscImage('anything')],
  ];
  getters.forEach(([label, fn]) => {
    const result = fn();
    ok(`${label} returns a non-empty string, never null/undefined/throws`, typeof result === 'string' && result.length > 0);
  });

  console.warn = originalWarn;
}

console.log('\n=== Fallback chain, with a controlled fake manifest (not the real committed one) ===');
{
  // Reach into the module's own require cache to swap in a fake manifest
  // for this block only, so the fallback-order logic itself can be
  // tested precisely without depending on what's actually configured for
  // production. Restored immediately after.
  const manifestPath = require.resolve('../../browser-tool/assets/images/image-manifest.json');
  const realManifest = require(manifestPath);
  const fakeManifest = {
    hero: { default: 'hero/default.jpg' },
    plans: { 200: 'plans/plan-200.jpg', default: 'plans/generic.jpg' },
    coverage: {},
    roomBoard: { 200: 'room-board/rb200.jpg' },
    hospital: {},
    misc: { default: 'misc/site-default.jpg' },
  };
  require.cache[manifestPath].exports = fakeManifest;
  delete require.cache[require.resolve('../../renderer/AssetManager')];
  const FreshAssetManager = require('../../renderer/AssetManager');

  const originalWarn = console.warn;
  let warnings = [];
  console.warn = (msg) => warnings.push(msg);

  check('an exact key match is used with no warning', FreshAssetManager.getPlanImage('Plan 200'), FreshAssetManager._resolveUrl('plans/plan-200.jpg'));
  check('no warning was logged for an exact match', warnings.length, 0);

  warnings = [];
  check('an unconfigured key falls back to that category\'s own default', FreshAssetManager.getPlanImage('Plan 750'), FreshAssetManager._resolveUrl('plans/generic.jpg'));
  ok('falling back to the category default logs a warning', warnings.length === 1);

  warnings = [];
  check('a category with no keys and no category-default falls back to the misc default', FreshAssetManager.getCoverageImage('RM1,200,000'), FreshAssetManager._resolveUrl('misc/site-default.jpg'));
  ok('falling all the way to the site-wide default logs a warning', warnings.length === 1);

  warnings = [];
  check('a single-image category (hero) with a real entry needs no fallback', FreshAssetManager.getHeroImage(), FreshAssetManager._resolveUrl('hero/default.jpg'));
  check('no warning for a configured single-image category', warnings.length, 0);

  warnings = [];
  check('a single-image category with nothing configured falls back to the misc default', FreshAssetManager.getHospitalImage(), FreshAssetManager._resolveUrl('misc/site-default.jpg'));
  ok('warning logged for the single-image fallback too', warnings.length === 1);

  console.warn = originalWarn;
  require.cache[manifestPath].exports = realManifest;
  delete require.cache[require.resolve('../../renderer/AssetManager')];
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
