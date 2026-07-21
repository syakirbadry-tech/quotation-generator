/**
 * test/run-sample.js
 *
 * Smoke test: runs the full parser against a real PruBSN quotation PDF
 * and asserts a set of values that were verified by hand against the
 * source document during development. Not a unit-test framework - just
 * enough to catch regressions before rendering work starts on top of
 * this parser.
 *
 * Usage: node test/run-sample.js [path-to-pdf]
 * Defaults to the sample PDF used throughout development if no path is given.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { extractPagesFromPdf } = require('../parser/pdfTextSource.node.js');
const { parseQuotation } = require('../parser/index.js');

const DEFAULT_SAMPLE =
  '/Users/syakir/Library/Mobile Documents/com~apple~CloudDocs/Santun_Syafitri_Binti_Mulyadi_14072026182021.pdf';

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

// --- Assertions against values verified by hand against the source PDF ---
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
check('metadata.productName', data.metadata.productName, 'PruBSN AnugerahMax');
check('metadata.quotationDate.iso', data.metadata.quotationDate.iso, '2026-07-14');
check('metadata.validUntil.iso', data.metadata.validUntil.iso, '2026-07-28');

// Client
check('client.fullName', data.client.fullName, 'Santun Syafitri Binti Mulyadi');
check('client.gender', data.client.gender, 'Female');
check('client.smokerStatus', data.client.smokerStatus, 'Non-Smoker');
check('client.occupationClass', data.client.occupationClass, 'Class 2');
check('client.ageNextBirthday', data.client.ageNextBirthday, 26);
check('client.dateOfBirth.iso', data.client.dateOfBirth.iso, '2001-01-12');

// Agent
check('agent.agentNameOnDocument', data.agent.agentNameOnDocument, 'MUHAMMAD SYAKIR BADRI BIN MD NIZAM');
check('agent.agentCode', data.agent.agentCode, '8LT00006');

// Plan
check('plan.basicPlanTerm', data.plan.basicPlanTerm, 44);
check('plan.basicSumCovered', data.plan.basicSumCovered, 10000);
check('plan.medicalPlanTier', data.plan.medicalPlanTier, 'Plan 200');
check('plan.coPaymentOption', data.plan.coPaymentOption, 'SmartSaver300');
check('plan.coverageToAge', data.plan.coverageToAge, 70);

// Contributions
check('contributions.isaContribution', data.contributions.isaContribution, 5);
check('contributions.medicTotalCareContribution', data.contributions.medicTotalCareContribution, 164);
check('contributions.protectionContribution', data.contributions.protectionContribution, 169);
check('contributions.wakalahCertificateCharge', data.contributions.wakalahCertificateCharge, 7);
check('contributions.totalMonthlyContribution', data.contributions.totalMonthlyContribution, 176);
check('contributions.totalAnnualContribution', data.contributions.totalAnnualContribution, 2112);
check('contributions.guaranteedDeathTPDBenefit', data.contributions.guaranteedDeathTPDBenefit, 10000);
check('contributions.totalContributionOverTerm', data.contributions.totalContributionOverTerm, 92928);
check('contributions.nonGuaranteedCashValueScenarioX', data.contributions.nonGuaranteedCashValueScenarioX, 2193);
check('contributions.nonGuaranteedCashValueScenarioY', data.contributions.nonGuaranteedCashValueScenarioY, 24570);

// Benefits
check('benefits.annualLimit', data.benefits.annualLimit, 'RM200,000');
check('benefits.lifetimeLimit', data.benefits.lifetimeLimit, 'No Lifetime Limit');
check('benefits.benefitItems.length', data.benefits.benefitItems.length, 18);
check('benefits.medicalExclusions.length', data.benefits.medicalExclusions.length, 3);
check('benefits.fullExclusionsList.length', data.benefits.fullExclusionsList.length, 28);

// Options
check('options.columns.length', data.options.columns.length, 3);
check(
  'options.columns[].annualContribution',
  data.options.columns.map((c) => c.annualContribution),
  [2112, 1860, 2952]
);
check(
  'options.columns[].coPaymentOption',
  data.options.columns.map((c) => c.coPaymentOption),
  ['SmartSaver300', 'SmartSaver1,000', 'Deductible RM500']
);
check('options.coverageTerm', data.options.coverageTerm, 'Until age 70');

// Projection
check('projection.projectionRows.length', data.projection.projectionRows.length, 5);
check('projection.projectionRows[0]', data.projection.projectionRows[0], {
  age: 26,
  currentContribution: 1968,
  projected7pct: null,
  projected10pct: null,
});
check('projection.medicalInflationAssumptionLow', data.projection.medicalInflationAssumptionLow, 7);
check('projection.medicalInflationAssumptionHigh', data.projection.medicalInflationAssumptionHigh, 10);

// This document's required fields should all be present - zero errors expected.
check('errors.length', errors.length, 0);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
