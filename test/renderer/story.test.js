/**
 * story.test.js
 *
 * renderer/renderStory.js against the committed synthetic AnugerahMax
 * PDF (parsed for real) and a hand-made Asas360-shaped quotation, so no
 * real client's data is needed. Checks the deck is built from the
 * quotation's own figures, skips what it can't know, keeps presenter
 * notes out of client copies, and that the inlined script is valid JS.
 *
 * Usage: node test/renderer/story.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { extractPagesFromPdf } = require('../../parser/pdfTextSource.node.js');
const { parseQuotation } = require('../../parser/index.js');
const { renderStoryHtml, buildStoryModel } = require('../../renderer/renderStory.js');
const { productFor } = require('../../renderer/story/products/index.js');
const { callName } = require('../../renderer/story/storyModel.js');

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
const ok = (label, cond) => check(label, Boolean(cond), true);
const scenes = (html) => [...html.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]);

const log = console.log;
console.log = () => {}; // the parser prints diagnostics
const amx = parseQuotation(extractPagesFromPdf(path.join(__dirname, '..', 'fixtures', 'synthetic-quotation.pdf')), { sourceFileName: 'synthetic.pdf', validityDays: 14 });
console.log = log;

const asas = {
  data: {
    metadata: { productName: 'PruBSN Asas360', quotationDate: { iso: '2026-11-05' }, quotationVersion: '1.3.76.0' },
    client: { fullName: 'Child', gender: 'Male', ageNextBirthday: 0, parent: { fullName: 'AINA BINTI AHMAD', gender: 'Female' } },
    agent: { agentCode: '8LT00006' },
    basicPlan: { basicPlanTerm: 70, basicSumCovered: 25000 },
    monthlyTotalAmountPayable: 406,
    totalAnnualContribution: 4872,
    medical: {
      riderName: 'Health360', planName: 'Health360 Plan 200', coverageModel: 'LIFETIME_MEDICAL_FUND', lifetimeFundAmount: 1000000,
      costSharingAfterExhaustion: { insurerPct: 80, clientPct: 20 }, lifetimeLimit: 'No Limit, subject to SVP',
      roomAndBoard: { amount: 200, maxDaysPerYear: 150 }, coPayment: 'Deductible RM500', coverageToAge: 70,
      benefitItems: [
        { label: 'Outpatient Cancer Treatment', value: 'As Charged, combined up to RM1,500,000 per lifetime' },
        { label: 'Outpatient Top Child Illnesses Treatment', value: 'As Charged, up to RM2,000 per Any One Disability' },
      ],
      waitingPeriods: [{ days: 120, description: 'Specified Illnesses' }, { days: 30, description: 'any other causes' }],
    },
    protection: { basicSumCovered: 25000, deathBenefit: { amount: 25000 }, cashValue: { schedule: [
      { year: 1, cashValueScenarioX: 0, cashValueScenarioY: 0 }, { year: 10, cashValueScenarioX: 16305, cashValueScenarioY: 17680 }, { year: 70, cashValueScenarioX: 146171, cashValueScenarioY: 547533 },
    ] } },
  },
};

console.log('=== names and products ===');
check('Malay call name skips Muhammad', callName('MUHAMMAD SYAFIQ BIN ZAINUDIN'), 'Syafiq');
check('call name keeps a plain first name', callName('Zati Nur Athirah'), 'Zati');
check('AnugerahMax profile', productFor(amx.data).id, 'anugerahmax');
check('Asas360 profile', productFor(asas.data).id, 'asas360');
check('unknown product falls back to generic', productFor({ metadata: { productName: 'PruBSN Something New' } }).id, 'generic');

console.log('=== AnugerahMax (synthetic PDF) ===');
const model = buildStoryModel(amx.data, productFor(amx.data));
ok('monthly contribution read from the quotation', Number.isFinite(model.monthly));
ok('annual limit read from the quotation', model.medical.annualLimit > 0);
const client = renderStoryHtml([amx]);
const agent = renderStoryHtml([amx], { presenterNotes: true });
ok('client copy has no presenter notes', !client.includes('class="notes"') && !client.includes('id="notesBtn"'));
ok('agent copy keeps presenter notes', agent.includes('class="notes"') && agent.includes('id="notesBtn"'));
ok('carries the publish marker', client.includes('id="pq-story"'));
ok('first scene is active', /<section class="slide is-active[^"]*" data-label="Intro"/.test(client));
ok('shows the quoted monthly figure', client.includes(`RM${model.monthly.toLocaleString('en-MY')}`));
ok('single quotation has no options scene', !scenes(client).includes('Your options'));
ok('answers save to the portal by themselves', client.includes('presentation-answers') && client.includes('queueSave'));
ok('no Send button', !client.includes('id="sendBtn"'));
const runtime = client.match(/<script>([\s\S]*)<\/script>/)[1];
ok('inlined runtime is valid JavaScript', (() => { try { new Function(runtime); return true; } catch (e) { return false; } })());

const two = renderStoryHtml([amx, { data: { ...amx.data, contributions: { ...amx.data.contributions, totalMonthlyContribution: (model.monthly || 0) + 110 } } }]);
ok('two quotations add the options scene', scenes(two).includes('Your options'));
ok('options say how much more Option 2 costs', two.includes('Option 2 is RM110 more a month'));

console.log('=== Asas360 (hand-made) ===');
const kid = renderStoryHtml([asas]);
const kidScenes = scenes(kid);
ok('unborn child: cover speaks to the parent', kid.includes('Aina Binti Ahmad') && kid.includes('before day one'));
ok('lifetime fund explained', kidScenes.includes('How the fund works') && kid.includes('RM1,000,000'));
ok('cost-sharing after the fund', kid.includes('80%') && kid.includes('20%'));
ok('deductible named in Path B', kid.includes('RM500</span> deductible'));
ok('child illness outpatient figure', kid.includes('RM2,000'));
ok('cash value chart from the schedule', kid.includes('id="growth"') && kid.includes('"points":[[1,0,0]'));
ok('no monthly breakdown when the quotation has none', !kidScenes.some((s) => /^Your RM/.test(s)));
ok('no made-up total over the term', !kid.includes('Total contribution over'));
ok('child photos used', kid.includes('child-ward1.jpg'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
