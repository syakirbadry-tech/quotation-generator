/**
 * composeClientDocument.test.js
 *
 * Unit test for browser-tool/application/composeClientDocument.js - the
 * compose-time string-append that attaches the Phase 4 client
 * application workflow onto the frozen renderer's output. No PDF, no
 * real client data, no browser needed: fabricated HTML/prefill data
 * only. Verifies (a) the renderer's own markup is passed through
 * byte-identical (never edited), (b) the workflow hooks (CTA button,
 * mount root, prefill JSON, inlined runtime script) are present, and
 * (c) a blocked/gated page (no `.sheet`) is returned unchanged, since
 * there's nothing to attach a workflow to.
 *
 * Usage: node test/browser-tool/composeClientDocument.test.js
 */

'use strict';

const assert = require('assert');
const { composeClientDocument } = require('../../browser-tool/application/composeClientDocument.js');

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

// A minimal stand-in for renderClientQuotationHtml()'s real output shape -
// not the real template, just something with the same `.sheet` marker
// documentShell()/renderQuotationCard() always produce.
const fakeQuotationHtml = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Medical Card Quotation — Test Client</title>
<style>:root{--teal:#178D93}</style>
<div class="sheet">
  <div class="head">fake header</div>
  <div class="body">fake body</div>
</div>
`;

const fakePrefillData = {
  quotation: { quotationNumber: 'Q-TEST-001', validUntil: '19 August 2026', planName: 'PruBSN Fake Plan', monthlyContribution: 'RM 123.45', riders: ['Fake Rider - Plan 200'] },
  agent: { name: 'Fake Agent', agency: 'Fake Agency', branch: 'Fake Branch', phone: '', email: '' },
  client: { fullName: 'Test Client', dateOfBirthIso: '1990-01-01', gender: 'Male' },
};

console.log('=== composeClientDocument: real (non-blocked) quotation ===');
{
  const out = composeClientDocument(fakeQuotationHtml, fakePrefillData);

  check('renderer output is preserved byte-for-byte at the start of the document', out.startsWith(fakeQuotationHtml), true);
  check('CTA button is present', out.includes('id="paf-continue-btn"'), true);
  check('application mount root is present and starts hidden', out.includes('id="paf-app-root"') && /id="paf-app-root"[^>]*hidden/.test(out), true);
  check('prefill data script block is present', out.includes('id="paf-prefill-data"'), true);
  check('inlined runtime script tag is present', /<script>[\s\S]*<\/script>\s*<script>/.test(out), true);

  const jsonMatch = out.match(/<script type="application\/json" id="paf-prefill-data">([\s\S]*?)<\/script>/);
  check('prefill JSON block was found', Boolean(jsonMatch), true);
  if (jsonMatch) {
    check('embedded prefill JSON round-trips to the exact input object', JSON.parse(jsonMatch[1]), fakePrefillData);
  }
}

console.log('\n=== composeClientDocument: JSON embedding is script-injection safe ===');
{
  const maliciousPrefill = { client: { fullName: '</script><script>alert(1)</script>' } };
  const out = composeClientDocument(fakeQuotationHtml, maliciousPrefill);
  check('a literal "</script>" from prefill data never appears unescaped in the output', out.includes('</script><script>alert(1)</script>'), false);

  const jsonMatch = out.match(/<script type="application\/json" id="paf-prefill-data">([\s\S]*?)<\/script>/);
  check('malicious value still round-trips correctly once parsed back', jsonMatch && JSON.parse(jsonMatch[1]).client.fullName, '</script><script>alert(1)</script>');
}

console.log('\n=== composeClientDocument: blocked/gated page passthrough ===');
{
  const blockedHtml = '<!doctype html>\n<meta charset="utf-8">\n<title>Quotation Not Ready</title>\n<h1>This quotation is not ready to send</h1>\n';
  const out = composeClientDocument(blockedHtml, fakePrefillData);
  check('a page with no .sheet card is returned completely unchanged', out, blockedHtml);
}

// The narrative renderer (renderer/renderNarrativeQuotation.js) wraps its
// document in `id="pq-doc"` instead of `class="sheet"`, and supplies its
// own visible "Continue Application" trigger (its bottom-of-page contact
// section's button, given the same `id="paf-continue-btn"` this module
// looks for) rather than relying on this module to inject a generic one.
console.log('\n=== composeClientDocument: narrative renderer (#pq-doc) is recognised as real ===');
{
  const narrativeHtml = `<!doctype html>
<meta charset="utf-8">
<title>Quotation — Test Client</title>
<style>:root{--teal:#178D93}</style>
<div id="pq-doc">
  <button type="button" id="paf-continue-btn" class="pq-cta">Continue Application &rarr;</button>
</div>
`;
  const out = composeClientDocument(narrativeHtml, fakePrefillData);

  check('renderer output is preserved byte-for-byte at the start of the document', out.startsWith(narrativeHtml), true);
  check('application mount root is present and starts hidden', out.includes('id="paf-app-root"') && /id="paf-app-root"[^>]*hidden/.test(out), true);
  check('prefill data script block is present', out.includes('id="paf-prefill-data"'), true);

  const continueBtnMatches = out.match(/id="paf-continue-btn"/g) || [];
  check('the renderer\'s own Continue Application button is kept, and no duplicate fallback button is injected', continueBtnMatches.length, 1);

  check('a standalone Print/Save-as-PDF control is embedded directly in the document (Phase 9: a published quotation has no surrounding agent-tool chrome to fall back on)', out.includes('id="pq-print-btn"'), true);
  check('the print control is wired to window.print(), not left dead', /pq-print-btn['"]\)[\s\S]{0,80}window\.print\(\)/.test(out), true);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
