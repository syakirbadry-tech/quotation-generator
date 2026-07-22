/**
 * test/run-sample-asas360.js
 *
 * Smoke test: runs the full parser against the real PruBSN Asas360 +
 * Health360 quotation PDF ("Yusuf & Ayah") and asserts a set of values
 * verified by hand against the source document during development - see
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md for page citations.
 * Mirrors test/run-sample.js's structure for the AnugerahMax product.
 *
 * Usage: node test/run-sample-asas360.js [path-to-pdf]
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { extractPagesFromPdf } = require('../parser/pdfTextSource.node.js');
const { parseQuotation } = require('../parser/index.js');

const DEFAULT_SAMPLE = '/Users/syakir/Library/Mobile Documents/com~apple~CloudDocs/Yusuf_&_Ayah_21072026221134.pdf';

const pdfPath = process.argv[2] || DEFAULT_SAMPLE;

console.log(`Parsing: ${pdfPath}\n`);

const pages = extractPagesFromPdf(pdfPath);
const result = parseQuotation(pages, {
  sourceFileName: path.basename(pdfPath),
  validityDays: 14,
});

const { data, warnings, errors } = result;

console.log('=== DATA ===');
console.log(JSON.stringify(data, null, 2));

console.log(`\n=== WARNINGS (${warnings.length}) ===`);
warnings.forEach((w) => console.log(`  [${w.field}] ${w.message}`));

console.log(`\n=== ERRORS (${errors.length}) ===`);
errors.forEach((e) => console.log(`  [${e.field}] ${e.message}`));

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

console.log('\n=== ASSERTIONS ===');

// Metadata
check('metadata.productName', data.metadata.productName, 'PruBSN Asas360');
check('metadata.quotationDate.iso', data.metadata.quotationDate.iso, '2026-07-21');
check('metadata.validUntil.iso', data.metadata.validUntil.iso, '2026-08-04');

// Client - juvenile certificate: "Person to be Covered" (Yusuf) + optional "Parent" column (Ayah)
check('client.fullName', data.client.fullName, 'Yusuf');
check('client.gender', data.client.gender, 'Male');
check('client.smokerStatus', data.client.smokerStatus, 'Non-Smoker');
check('client.ageNextBirthday', data.client.ageNextBirthday, 1);
check('client.parent.fullName', data.client.parent.fullName, 'Ayah');
check('client.parent.gender', data.client.parent.gender, 'Male');
check('client.parent.smokerStatus', data.client.parent.smokerStatus, 'Smoker');
check('client.parent.ageNextBirthday', data.client.parent.ageNextBirthday, 29);

// Agent (already onboarded in parser/agents.js - no new agent code needed)
check('agent.agentNameOnDocument', data.agent.agentNameOnDocument, 'MUHAMMAD SYAKIR BADRI BIN MD NIZAM');
check('agent.agentCode', data.agent.agentCode, '8LT00006');

// Universal Medical JSON - LIFETIME_MEDICAL_FUND coverage model
check('medical.productName', data.medical.productName, 'PruBSN Asas360');
check('medical.riderName', data.medical.riderName, 'Health360');
check('medical.planName', data.medical.planName, 'Health360 Plan 200');
check('medical.planTier', data.medical.planTier, '200');
check('medical.coverageModel', data.medical.coverageModel, 'LIFETIME_MEDICAL_FUND');
check('medical.annualLimit', data.medical.annualLimit, null);
check('medical.lifetimeFundAmount', data.medical.lifetimeFundAmount, 1000000);
check('medical.lifetimeLimit (exact PDS wording, p.14)', data.medical.lifetimeLimit, 'No Limit, subject to SVP');
check('medical.costSharingAfterExhaustion', data.medical.costSharingAfterExhaustion, { insurerPct: 80, clientPct: 20 });
check('medical.roomAndBoard', data.medical.roomAndBoard, { amount: 200, maxDaysPerYear: 150 });
check('medical.coPayment', data.medical.coPayment, 'Deductible RM500');
check('medical.coverageToAge', data.medical.coverageToAge, 60);
check('medical.contribution', data.medical.contribution, null); // never derived - see the matching warning below
check('medical.benefitItems.length', data.medical.benefitItems.length, 20);
// Merged-cell inheritance (see extractors/asas360.js): rows with no value
// printed on their own row inherit "Hospital & Surgical Benefits"'s single
// bare "As Charged" value, confirmed against the Appendix's own prose for
// each - never fabricated, verified real values.
check(
  'medical.benefitItems: merged-cell "As Charged" rows',
  ['Intensive Care Unit (ICU) / Cardiac Care Unit (CCU)', 'Pre-hospitalisation Treatment', 'Post-hospitalisation Treatment', 'Major Organ Transplant'].map(
    (label) => data.medical.benefitItems.find((b) => b.label === label).value
  ),
  [
    'As Charged (maximum 150 days per year)',
    'As Charged (within 120 days immediately before Hospitalisation)',
    'As Charged (within 120 days immediately after Hospitalisation)',
    'As Charged (once per lifetime)',
  ]
);
// Outpatient Cancer Treatment (g) and Outpatient Kidney Dialysis Treatment
// (h) share ONE merged value cell in the source - both must show the full
// combined sentence, not half each (see extractors/asas360.js).
check(
  'medical.benefitItems: g)/h) combined merged value',
  ['Outpatient Cancer Treatment', 'Outpatient Kidney Dialysis Treatment'].map(
    (label) => data.medical.benefitItems.find((b) => b.label === label).value
  ),
  ['As Charged, combined up to RM1,500,000 per lifetime', 'As Charged, combined up to RM1,500,000 per lifetime']
);
check('medical.fullExclusionsList.length', data.medical.fullExclusionsList.length, 33);
check('medical.waitingPeriods', data.medical.waitingPeriods, [
  { days: 120, description: 'Specified Illnesses' },
  { days: 30, description: 'any other causes' },
  { days: 180, description: 'Mental Care Treatment' },
]);
// Exclusion (ff) spans a page break in the source - must be clean prose,
// never contaminated with the page footer/header that lands mid-item.
check(
  'medical.fullExclusionsList: (ff) is not contaminated by page-break footer/header noise',
  data.medical.fullExclusionsList.find((e) => e.marker === 'ff').text,
  "Experimental treatment, including medication and/or unconventional medical technology/procedure, which has not been proved to be effective, based on established medical practice, and which has not been approved by a recognised body in Malaysia; or"
);
// Exclusion (gg) must not absorb the trailing "This list is non-exhaustive..." disclaimer that follows it in the source.
check(
  'medical.fullExclusionsList: (gg) does not absorb the trailing disclaimer sentence',
  data.medical.fullExclusionsList.find((e) => e.marker === 'gg').text,
  "Care or treatment that does not lead to a recovery, conservation of the Covered Person's condition or restoration to the Covered Person's previous state of health."
);

// Directly printed contribution figures (Monthly Total Amount Payable / Total Annual Contribution)
check('monthlyTotalAmountPayable', data.monthlyTotalAmountPayable, 337);
check('totalAnnualContribution', data.totalAnnualContribution, 4044);

// No individual benefit row should come back with a null value - every one
// of the 20 known Health360 rows must resolve to real, printed text.
check(
  'medical.benefitItems - no null values',
  data.medical.benefitItems.filter((b) => b.value == null).map((b) => b.label),
  []
);

// This document has one known, honest limitation (see fromAsas360()'s own
// comment) plus a handful of genuinely-merged-cell benefit rows - not
// bugs, so they're asserted as the *expected* warnings.
check(
  'warnings',
  warnings.map((w) => w.field).sort(),
  [
    'medical.contribution',
    'medicalRider.benefitItems.Intensive Care Unit (ICU) / Cardiac Care Unit (CCU)',
    'medicalRider.benefitItems.Major Organ Transplant',
    'medicalRider.benefitItems.Post-hospitalisation Treatment',
    'medicalRider.benefitItems.Pre-hospitalisation Treatment',
  ]
);
// The "What is covered? / What is not covered?" short digest DOES exist
// for Health360 (Step 2 of its own PDS) - reuses the same generic
// two-column reconstruction AnugerahMax's extractBenefits.js already
// uses; this was previously (incorrectly) assumed not to exist.
check('medical.medicalExclusions.length', data.medical.medicalExclusions.length, 3);

// Universal Protection JSON (see normalize/toProtectionJson.js) - kept
// separate from data.medical. Death/TPD Benefit is genuinely formula-
// based for Asas360 (Basic Sum Covered plus/before the cash value of the
// certificate, per Appendix: Death & TPD Benefit, p.19) - never a
// fabricated single combined figure.
check('protection.basicPlanName', data.protection.basicPlanName, 'PruBSN Asas360 (Basic)');
check('protection.basicPlanTerm', data.protection.basicPlanTerm, 59);
check('protection.basicSumCovered', data.protection.basicSumCovered, 25000);
check('protection.deathBenefit', data.protection.deathBenefit, {
  amount: 25000,
  description: 'Basic Sum Covered plus the cash value of the certificate',
});
check('protection.tpdBenefit', data.protection.tpdBenefit, {
  amount: 25000,
  description: "Basic Sum Covered, payable before the certificate anniversary of the Covered Person's age 70 next birthday",
});
// Asas360 never prints a single "the" cash value (investment-linked,
// varies by year/scenario) - only Table 1's real year-by-year schedule.
check('protection.cashValue.scenarioX (never a fabricated single figure)', data.protection.cashValue.scenarioX, null);
check('protection.cashValue.scenarioY (never a fabricated single figure)', data.protection.cashValue.scenarioY, null);
check('protection.cashValue.schedule.length (Table 1, p.5 - 16 certificate years)', data.protection.cashValue.schedule.length, 16);
check('protection.cashValue.schedule[0] (year 1, matches Table 1 exactly)', data.protection.cashValue.schedule[0], {
  year: 1,
  contributionPaid: 4044,
  sumCovered: 10000,
  cashValueScenarioX: 388,
  cashValueScenarioY: 394,
  deathBenefitScenarioX: 10388,
  deathBenefitScenarioY: 10394,
});
check('protection.cashValue.schedule[last] (year 59, matches Table 1 exactly)', data.protection.cashValue.schedule[data.protection.cashValue.schedule.length - 1], {
  year: 59,
  contributionPaid: 4044,
  sumCovered: 25000,
  cashValueScenarioX: 103461,
  cashValueScenarioY: 267740,
  deathBenefitScenarioX: 128461,
  deathBenefitScenarioY: 292740,
});
// The real, printed per-year Health360-specific Tabarru' deduction (Table
// 3, p.8) - fulfils the promise medical.contribution's own warning makes
// ("see Table 3's Tabarru' deduction schedule instead").
check('medical.tabarruDeductionSchedule.length', data.medical.tabarruDeductionSchedule.length, 16);
check('medical.tabarruDeductionSchedule[0] (year 1: RM2,670 Health360-specific Tabarru\')', data.medical.tabarruDeductionSchedule[0], {
  year: 1,
  basicTabarru: 39,
  vitalCarePlusTabarru: 40,
  health360Tabarru: 2670,
  crisisProtectorTabarru: 0,
});

check('errors.length', errors.length, 0);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
