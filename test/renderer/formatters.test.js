/**
 * formatters.test.js
 *
 * Regression coverage for renderer/formatters.js's shortValue()/
 * compactRate(). Added after a live end-to-end browser run surfaced a
 * real bug: a benefit value with its parenthetical day-count note BEFORE
 * the figure (e.g. from the synthetic test fixture) made the Room &
 * Board key-figure card and medical-card mockup silently fall back to
 * "Refer to certificate", while the benefits table right below them
 * (which extracts via primaryValue(), not compactRate()) showed the real
 * value - a visible inconsistency on the same generated document.
 *
 * Usage: node test/renderer/formatters.test.js
 */

'use strict';

const assert = require('assert');
const { shortValue, compactRate, primaryValue, formatMoneyFixed2, resolveMonthlyTotalPayable } = require('../../renderer/formatters');

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

console.log('=== shortValue: parenthetical note position ===');
check('note trailing the figure (the common case)', shortValue('RM200 per day (maximum 150 days per rider year)'), 'RM200 per day');
check('note LEADING the figure (the bug this test guards against)', shortValue('(maximum 150 days per rider year) RM200 per day'), 'RM200 per day');
check('no parenthetical at all', shortValue('As charged'), 'As charged');
check('two parenthetical groups', shortValue('RM200 per day (max 150 days) (rider only)'), 'RM200 per day');
check('null/empty input stays null', shortValue(null), null);
check(
  'a value that is ONLY a parenthetical (e.g. the ICU/CCU row\'s bare day-count note - see KNOWN_LIMITATIONS.md #2) returns null, not the raw note text - it is not a real coverage figure',
  shortValue('(maximum 150 days per rider year)'),
  null
);

console.log('\n=== compactRate: same leading-note case, through the real call path ===');
check('note trailing', compactRate('RM200 per day (maximum 150 days per rider year)'), 'RM 200/day');
check('note leading - previously returned "" and made the caller fall back to a placeholder', compactRate('(maximum 150 days per rider year) RM200 per day'), 'RM 200/day');

console.log('\n=== primaryValue: confirm it was already correct (regex-based, not shortValue-based) ===');
check('note leading', primaryValue('(maximum 150 days per rider year) RM200 per day'), 'RM200 per day');
check('note trailing', primaryValue('RM200 per day (maximum 150 days per rider year)'), 'RM200 per day');
check(
  'a bare day-count note with no real figure (ICU/CCU row - KNOWN_LIMITATIONS.md #2) still falls through to null, so the renderer shows its neutral "missing" treatment, not raw parenthetical text as if it were a value',
  primaryValue('(maximum 150 days per rider year)'),
  null
);

console.log('\n=== formatMoneyFixed2: "Monthly Total Amount Payable" must always be exactly RM X.XX ===');
check('a whole number still gets 2 decimals - "246" -> "246.00", never bare "246"', formatMoneyFixed2(246), '246.00');
check('an amount already carrying cents keeps them, not rounded away', formatMoneyFixed2(246.5), '246.50');
check('thousands separator is preserved alongside the fixed 2dp', formatMoneyFixed2(2112), '2,112.00');
check('null input stays null (caller decides the "missing" placeholder, this never invents a number)', formatMoneyFixed2(null), null);
check('non-finite input (e.g. a bad parser value) stays null rather than printing "NaN.00"', formatMoneyFixed2(NaN), null);

console.log('\n=== resolveMonthlyTotalPayable: extraction-first, annual/12 fallback only when the real figure is missing ===');
check(
  'the PDF-extracted figure (totalMonthlyContribution) is always used when present - never recalculated even if it would disagree with annual/12',
  resolveMonthlyTotalPayable({ totalMonthlyContribution: 176, totalAnnualContribution: 9999 }),
  176
);
check(
  'falls back to totalAnnualContribution / 12 only when totalMonthlyContribution is null',
  resolveMonthlyTotalPayable({ totalMonthlyContribution: null, totalAnnualContribution: 2952 }),
  246
);
check(
  'the fallback rounds to exactly 2 decimal places (2952/12 = 246 exactly here; a non-exact case must not grow extra digits)',
  resolveMonthlyTotalPayable({ totalMonthlyContribution: null, totalAnnualContribution: 1000 }),
  83.33
);
check('neither figure present resolves to null, not 0 or NaN', resolveMonthlyTotalPayable({}), null);
check('resolveMonthlyTotalPayable never throws on a missing contributions object entirely', resolveMonthlyTotalPayable(undefined), null);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
