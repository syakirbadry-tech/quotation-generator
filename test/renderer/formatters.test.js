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
const { shortValue, compactRate, primaryValue } = require('../../renderer/formatters');

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

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
