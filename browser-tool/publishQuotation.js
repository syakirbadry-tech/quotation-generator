/**
 * publishQuotation.js
 *
 * Phase 9 - the ONLY place in the agent tool (browser-tool/app.js and
 * everything else `app.js` calls) that makes a network request. Sends
 * the already-rendered client quotation document (the exact same HTML
 * the agent could otherwise download or print - see app.js's generate
 * handler) to the Cloudflare Worker's POST /publish endpoint, which
 * stores it and returns a public URL - see backend/src/publish.js and
 * backend/src/worker.js for the server side.
 *
 * What leaves the browser: the client's name, plan, contribution
 * figures, and the full rendered quotation HTML/JSON - NOT the source
 * PDF (that is parsed locally and never uploaded anywhere by this
 * project). This is a deliberate, user-confirmed change from this
 * project's earlier "100% local, nothing leaves your machine" posture -
 * publishing a shareable client link is the whole point of this phase.
 *
 * PUBLISH_ENDPOINT below is the real, deployed production Worker URL
 * (see ../DEPLOYMENT.md for deployment details) - update it if the
 * Worker is ever redeployed under a different name/subdomain.
 */

'use strict';

const PUBLISH_ENDPOINT = 'https://prubsn-submission-service.syakirbadry.workers.dev/publish';

const { formatMoney, formatMoneyFixed2, resolveMonthlyTotalPayable } = require('../renderer/formatters.js');

function buildPublishPayload(data, generatedHtml, rendererVersion) {
  const contributions = (data && data.contributions) || {};
  const monthlyValue = resolveMonthlyTotalPayable(contributions);
  const annualValue = contributions.totalAnnualContribution;

  return {
    clientName: (data && data.client && data.client.fullName) || 'Client',
    plan: (data && data.metadata && data.metadata.productName) || null,
    monthlyTotalPayable: monthlyValue != null ? `RM ${formatMoneyFixed2(monthlyValue)}` : null,
    annualContribution: annualValue != null ? `RM ${formatMoney(annualValue)}` : null,
    rendererVersion,
    quotationJson: data,
    generatedHtml,
  };
}

/**
 * @param {object} data the parser's `data` object for this quotation
 * @param {string} generatedHtml the fully composed client document (post composeClientDocument)
 * @param {string} rendererVersion see renderer/renderNarrativeQuotation.js's RENDERER_VERSION
 * @returns {Promise<{status: 'success', url: string, id: string} | {status: 'failed', error: string}>}
 */
async function publishQuotation(data, generatedHtml, rendererVersion) {
  const payload = buildPublishPayload(data, generatedHtml, rendererVersion);
  try {
    const res = await fetch(PUBLISH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let body;
    try {
      body = await res.json();
    } catch (e) {
      return { status: 'failed', error: 'The publishing service returned an unexpected response.' };
    }
    if (!res.ok || !body.success) {
      return { status: 'failed', error: (body && body.error) || 'Could not publish this quotation.' };
    }
    return { status: 'success', url: body.url, id: body.id };
  } catch (err) {
    return { status: 'failed', error: 'Could not reach the publishing service. Check your connection and try again.' };
  }
}

module.exports = { publishQuotation, buildPublishPayload, PUBLISH_ENDPOINT };
