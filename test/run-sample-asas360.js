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
check('medical.costSharingAfterExhaustion', data.medical.costSharingAfterExhaustion, { insurerPct: 80, clientPct: 20 });
check('medical.roomAndBoard', data.medical.roomAndBoard, { amount: 200, maxDaysPerYear: 150 });
check('medical.coPayment', data.medical.coPayment, 'Deductible RM500');
check('medical.coverageToAge', data.medical.coverageToAge, 60);
check('medical.contribution', data.medical.contribution, null); // never derived - see the matching warning below
check('medical.benefitItems.length', data.medical.benefitItems.length, 20);
check('medical.fullExclusionsList.length', data.medical.fullExclusionsList.length, 33);
check('medical.waitingPeriods', data.medical.waitingPeriods, [
  { days: 120, description: 'Specified Illnesses' },
  { days: 30, description: 'any other causes, and' },
  { days: 180, description: 'Mental Care Treatment' },
]);

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

// This document has two known, honest limitations (see fromAsas360()'s own
// comments) - not bugs, so they're asserted as the *expected* warnings.
check(
  'warnings',
  warnings.map((w) => w.field).sort(),
  ['medical.contribution', 'medical.medicalExclusions']
);
check('errors.length', errors.length, 0);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
