/**
 * agentBranding.test.js
 *
 * Regression coverage for the header logo: an agent with a real `logo`
 * configured in parser/agents.js should see it rendered as an <img>;
 * an agent with none (agents.js's documented default - '', never
 * fabricated) should keep getting the generic gold-mark SVG. Temporarily
 * adds a throwaway entry to the real, frozen AGENTS object (never edits
 * agents.js itself) so this can be tested without a mocking framework,
 * and removes it again in `finally` regardless of pass/fail.
 *
 * Usage: node test/renderer/agentBranding.test.js
 */

'use strict';

const assert = require('assert');
const { AGENTS } = require('../../parser/agents');
const { renderClientQuotationHtml } = require('../../renderer/renderQuotation');

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

function minimalParseResult(agentCode) {
  return {
    data: {
      metadata: {},
      client: { fullName: 'Test Client' },
      agent: { agentCode },
      plan: {},
      contributions: {},
      benefits: { benefitItems: [] },
      options: {},
      projection: {},
    },
    warnings: [],
    errors: [],
  };
}

console.log('=== Agent branding: logo present vs. absent ===');

AGENTS['TEST-LOGO-AGENT'] = {
  name: 'Test Agent', agency: 'Test Agency', branch: 'Test Branch', location: '',
  phone: '', whatsapp: '', email: '', logo: 'https://example.com/agency-logo.png', photo: '',
};
AGENTS['TEST-NO-LOGO-AGENT'] = {
  name: 'Test Agent', agency: 'Test Agency', branch: 'Test Branch', location: '',
  phone: '', whatsapp: '', email: '', logo: '', photo: '',
};

try {
  const withLogo = renderClientQuotationHtml(minimalParseResult('TEST-LOGO-AGENT'), { acknowledged: true });
  ok('a configured logo renders as an <img class="mark"> using the exact URL from agents.js', withLogo.includes('<img class="mark" src="https://example.com/agency-logo.png"'));
  ok('the generic SVG mark is NOT used when a real logo is configured', !withLogo.includes('<svg class="mark"'));

  const withoutLogo = renderClientQuotationHtml(minimalParseResult('TEST-NO-LOGO-AGENT'), { acknowledged: true });
  ok('no logo configured (agents.js default \'\') falls back to the generic SVG mark', withoutLogo.includes('<svg class="mark"'));
  ok('no <img> tag is fabricated when there is no real logo on file', !withoutLogo.includes('<img class="mark"'));

  const unconfiguredAgent = renderClientQuotationHtml(minimalParseResult('NOT-A-REAL-CODE'), { acknowledged: true });
  ok('an agent code with no config entry at all also falls back to the generic SVG mark, never a broken <img>', unconfiguredAgent.includes('<svg class="mark"') && !unconfiguredAgent.includes('<img class="mark"'));
} finally {
  delete AGENTS['TEST-LOGO-AGENT'];
  delete AGENTS['TEST-NO-LOGO-AGENT'];
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
