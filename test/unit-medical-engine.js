/**
 * test/unit-medical-engine.js
 *
 * Unit tests (not exercised by the two full-PDF regression tests) for the
 * Medical Card Engine's Version 1 architecture modules - see
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md's "Verification
 * plan". Uses synthetic minimal input, not a real PDF, since these modules
 * are pure functions/lookups that don't need one.
 *
 * Usage: node test/unit-medical-engine.js
 */

'use strict';

const assert = require('assert');
const { classifyDocument } = require('../parser/classifyDocument');
const { buildDocument } = require('../parser/lineUtils');
const { getCoverageStrategy } = require('../parser/coverageStrategy');
const { validateMedical } = require('../parser/validateMedical');
const { fromAnugerahMax, fromAsas360 } = require('../parser/normalize/toMedicalJson');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    pass++;
  } catch (err) {
    console.log(`  FAIL  ${label}\n        ${err.message}`);
    fail++;
  }
}

console.log('=== classifyDocument ===');

check('unrecognised document returns product: null', () => {
  const doc = buildDocument(['Some totally unrelated PDF text', 'Nothing matches here']);
  assert.strictEqual(classifyDocument(doc).product, null);
});

check('AnugerahMax + Medic TotalCare anchors classify as anugerahmax', () => {
  const doc = buildDocument(['PruBSN AnugerahMax', 'Medic TotalCare rider details']);
  assert.strictEqual(classifyDocument(doc).product, 'anugerahmax');
});

check('Asas360 + Health360 anchors classify as asas360', () => {
  const doc = buildDocument(['PruBSN Asas360', 'Health360 rider details']);
  assert.strictEqual(classifyDocument(doc).product, 'asas360');
});

console.log('\n=== coverageStrategy ===');

check('ANNUAL_LIMIT strategy has the exact specified explanation and flags', () => {
  const s = getCoverageStrategy('ANNUAL_LIMIT');
  assert.strictEqual(s.explanation, 'This medical card provides an annual medical limit that refreshes every policy year.');
  assert.strictEqual(s.showsCriticalIllnessDoubling, true);
  assert.strictEqual(s.showsLifetimeFundChart, false);
});

check('LIFETIME_MEDICAL_FUND strategy has the exact specified explanation and flags', () => {
  const s = getCoverageStrategy('LIFETIME_MEDICAL_FUND');
  assert.strictEqual(
    s.explanation,
    "This medical card provides a lifetime medical fund. After the allocated medical fund has been exhausted, eligible claims continue under an 80% (PruBSN) / 20% (client) cost-sharing arrangement, subject to the policy terms."
  );
  assert.strictEqual(s.showsCriticalIllnessDoubling, false);
  assert.strictEqual(s.showsLifetimeFundChart, true);
});

check('unrecognised or missing coverage model returns null, never a guessed default', () => {
  assert.strictEqual(getCoverageStrategy('SOMETHING_ELSE'), null);
  assert.strictEqual(getCoverageStrategy(undefined), null);
  assert.strictEqual(getCoverageStrategy(null), null);
});

console.log('\n=== toMedicalJson (both mappers) ===');

check('fromAnugerahMax: ANNUAL_LIMIT-only fields populated, LIFETIME_MEDICAL_FUND fields null (never fabricated)', () => {
  const raw = {
    metadata: { productName: 'PruBSN AnugerahMax' },
    plan: { medicalRiderName: 'Medic TotalCare', medicalPlanTier: 'Plan 200', coPaymentOption: 'SmartSaver300', coverageToAge: 70 },
    contributions: { medicTotalCareContribution: 164 },
    benefits: {
      annualLimit: 'RM200,000',
      lifetimeLimit: 'No Lifetime Limit',
      benefitItems: [{ section: 'IN-PATIENT CARE BENEFITS', label: 'Hospital Daily Room and Board', value: 'RM200 per day (maximum 150 days per rider year)' }],
      medicalExclusions: ['a', 'b'],
      fullExclusionsList: [{ marker: 'a', text: 'x' }],
      waitingPeriods: [{ days: 30, description: 'x' }],
    },
  };
  const medical = fromAnugerahMax(raw);
  assert.strictEqual(medical.coverageModel, 'ANNUAL_LIMIT');
  assert.strictEqual(medical.annualLimit, 'RM200,000');
  assert.strictEqual(medical.lifetimeFundAmount, null);
  assert.strictEqual(medical.costSharingAfterExhaustion, null);
  assert.deepStrictEqual(medical.roomAndBoard, { amount: 200, maxDaysPerYear: 150 });
  assert.strictEqual(medical.contribution, 164);
});

check('fromAsas360: LIFETIME_MEDICAL_FUND-only fields populated, ANNUAL_LIMIT fields null (never fabricated)', () => {
  const raw = {
    metadata: { productName: 'PruBSN Asas360' },
    medicalRider: {
      riderName: 'Health360',
      planTier: '200',
      coverageToAge: 60,
      contribution: null,
      benefitItems: [{ section: 'Room & Board Benefits', label: 'Hospital Daily Room & Board', value: 'Up to RM200 per day (maximum 150 days per year)' }],
      medicalExclusions: [],
      fullExclusionsList: [{ marker: 'a', text: 'x' }],
      waitingPeriods: [{ days: 120, description: 'x' }],
      smartValuePoint: 1000000,
      lifetimeLimit: 'No Limit, subject to Smart Value Point',
      coPaymentOption: 'Deductible RM500',
    },
  };
  const warnings = [];
  const medical = fromAsas360(raw, warnings);
  assert.strictEqual(medical.coverageModel, 'LIFETIME_MEDICAL_FUND');
  assert.strictEqual(medical.annualLimit, null);
  assert.strictEqual(medical.lifetimeFundAmount, 1000000);
  assert.deepStrictEqual(medical.costSharingAfterExhaustion, { insurerPct: 80, clientPct: 20 });
  assert.deepStrictEqual(medical.roomAndBoard, { amount: 200, maxDaysPerYear: 150 });
  assert.strictEqual(medical.contribution, null);
  assert.ok(warnings.some((w) => w.field === 'medical.contribution'));
});

check('fromAsas360: no Smart Value Point means no fabricated cost-sharing split', () => {
  const medical = fromAsas360({ metadata: {}, medicalRider: { smartValuePoint: null } });
  assert.strictEqual(medical.lifetimeFundAmount, null);
  assert.strictEqual(medical.costSharingAfterExhaustion, null);
});

console.log('\n=== validateMedical ===');

check('null medical object produces exactly one error', () => {
  assert.strictEqual(validateMedical(null).errors.length, 1);
});

check('ANNUAL_LIMIT model is never flagged for LIFETIME_MEDICAL_FUND-only fields', () => {
  const medical = {
    productName: 'p', riderName: 'r', planName: 'pl', coverageModel: 'ANNUAL_LIMIT',
    roomAndBoard: { amount: 1, maxDaysPerYear: 1 }, coPayment: 'x', coverageToAge: 70,
    annualLimit: 'RM200,000',
  };
  const { errors } = validateMedical(medical);
  assert.strictEqual(errors.length, 0);
});

check('LIFETIME_MEDICAL_FUND model is never flagged for ANNUAL_LIMIT-only fields', () => {
  const medical = {
    productName: 'p', riderName: 'r', planName: 'pl', coverageModel: 'LIFETIME_MEDICAL_FUND',
    roomAndBoard: { amount: 1, maxDaysPerYear: 1 }, coPayment: 'x', coverageToAge: 60,
    lifetimeFundAmount: 1000000, costSharingAfterExhaustion: { insurerPct: 80, clientPct: 20 },
  };
  const { errors } = validateMedical(medical);
  assert.strictEqual(errors.length, 0);
});

check('missing model-specific required field is flagged, with the coverage model named in the message', () => {
  const medical = {
    productName: 'p', riderName: 'r', planName: 'pl', coverageModel: 'ANNUAL_LIMIT',
    roomAndBoard: { amount: 1, maxDaysPerYear: 1 }, coPayment: 'x', coverageToAge: 70,
  };
  const { errors } = validateMedical(medical);
  assert.ok(errors.some((e) => e.field === 'medical.annualLimit'));
});

check('unrecognised coverage model is flagged as an error', () => {
  const medical = {
    productName: 'p', riderName: 'r', planName: 'pl', coverageModel: 'MYSTERY',
    roomAndBoard: { amount: 1, maxDaysPerYear: 1 }, coPayment: 'x', coverageToAge: 70,
  };
  const { errors } = validateMedical(medical);
  assert.ok(errors.some((e) => e.field === 'medical.coverageModel'));
});

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
