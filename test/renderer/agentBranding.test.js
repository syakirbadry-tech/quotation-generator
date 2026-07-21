/**
 * agentBranding.test.js
 *
 * Regression coverage for the agent-footer logo in the narrative
 * renderer (renderer/renderNarrativeQuotation.js, wired up via
 * renderClientQuotationHtml as of the official-template migration): an
 * agent with a real `logo` configured in parser/agents.js should see it
 * rendered as an <img> in the "Ready When You Are" footer; an agent with
 * none (agents.js's documented default - '', never fabricated) should
 * see no <img> at all there - never a broken image, never an invented
 * URL. (The old medical-card renderer instead always showed some mark -
 * a real logo <img class="mark"> or a generic gold SVG fallback - which
 * made sense in that compact card layout; the new long-form layout's
 * footer is fully identified by the agent's name/code/agency text alone,
 * so omitting the image entirely when there's no real logo is the
 * equivalent "never fabricate" behaviour here.) Temporarily adds a
 * throwaway entry to the real, frozen AGENTS object (never edits
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
  ok('a configured logo renders as an <img> using the exact URL from agents.js', withLogo.includes('<img src="https://example.com/agency-logo.png"'));

  const withoutLogo = renderClientQuotationHtml(minimalParseResult('TEST-NO-LOGO-AGENT'), { acknowledged: true });
  ok('no logo configured (agents.js default \'\') renders no <img> at all in the agent footer', !withoutLogo.includes('<img src='));

  const unconfiguredAgent = renderClientQuotationHtml(minimalParseResult('NOT-A-REAL-CODE'), { acknowledged: true });
  ok('an agent code with no config entry at all also renders no <img>, never a broken/invented one', !unconfiguredAgent.includes('<img src='));
} finally {
  delete AGENTS['TEST-LOGO-AGENT'];
  delete AGENTS['TEST-NO-LOGO-AGENT'];
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
