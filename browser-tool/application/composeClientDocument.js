/**
 * composeClientDocument.js
 *
 * COMPOSE-TIME module - runs inside app.bundle.js, in the agent's
 * browser. Takes the frozen renderer's output HTML string and
 * string-APPENDS the client application workflow onto it: never edits
 * renderer markup, never touches `.sheet`'s contents. This is the only
 * place the two build stages meet - `__APPLICATION_RUNTIME_SOURCE__` is
 * a compile-time constant injected by esbuild's `define` (see
 * scripts/build-browser-tool.js), containing the fully bundled text of
 * clientRuntime.js and everything it requires.
 *
 * If `quotationHtml` isn't a real (non-blocked) quotation - i.e. it
 * doesn't contain the renderer's `.sheet` card - there is nothing to
 * attach a workflow to, so the input is returned unchanged.
 */

'use strict';

/* global __APPLICATION_RUNTIME_SOURCE__ */

const APPLICATION_STYLE = `
.paf-cta{display:block;margin:24px auto 0;padding:14px 28px;border:none;border-radius:999px;
  background:linear-gradient(135deg,var(--teal),var(--teal-dk));color:#fff;font-family:var(--sans);
  font-size:15px;font-weight:600;letter-spacing:.01em;cursor:pointer;box-shadow:0 4px 14px rgba(23,141,147,.3)}
.paf-cta:hover{filter:brightness(1.05)}
.paf-app-root{max-width:800px;margin:24px auto 0;font-family:var(--sans);color:var(--ink)}
.paf-shell{background:var(--card);border-radius:16px;border:1px solid var(--line);padding:28px 24px}
.paf-back-link{display:inline-block;background:none;border:none;color:var(--teal-dk);font-family:var(--sans);
  font-size:13px;font-weight:600;cursor:pointer;padding:0 0 16px;margin:0}
.paf-progress{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0 0 24px}
.paf-progress-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--meta);font-family:var(--sans)}
.paf-progress-dot{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;
  border-radius:50%;background:var(--rose-soft);color:var(--ink);font-size:11px;font-weight:700}
.paf-progress-current .paf-progress-dot{background:var(--teal);color:#fff}
.paf-progress-done .paf-progress-dot{background:var(--gold-a);color:#fff}
.paf-progress-current .paf-progress-label{color:var(--ink);font-weight:600}
.paf-step-title{font-family:var(--serif);font-size:20px;margin:0 0 4px;color:var(--ink)}
.paf-step-subtitle{font-size:13px;color:var(--meta);margin:0 0 20px}
.paf-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.paf-field{display:flex;flex-direction:column;gap:6px}
.paf-field:has(textarea){grid-column:1/-1}
.paf-field-wide{grid-column:1/-1}
.paf-label{font-size:12px;font-weight:600;color:var(--ink)}
.paf-optional{font-weight:400;color:var(--meta)}
.paf-input{font-family:var(--sans);font-size:14px;padding:10px 12px;border:1px solid var(--line);
  border-radius:8px;background:#fff;color:var(--ink)}
.paf-input:focus{outline:2px solid var(--teal);outline-offset:1px}
.paf-input-error{border-color:#B3261E}
.paf-error{font-size:12px;color:#B3261E}
.paf-nav{display:flex;justify-content:space-between;align-items:center;margin-top:24px}
.paf-btn{font-family:var(--sans);font-size:14px;font-weight:600;padding:10px 22px;border-radius:999px;
  cursor:pointer;border:none}
.paf-btn-primary{background:linear-gradient(135deg,var(--teal),var(--teal-dk));color:#fff;margin-left:auto}
.paf-btn-secondary{background:none;border:1px solid var(--line);color:var(--ink)}
.paf-review-section{padding:16px 0;border-bottom:1px solid var(--line)}
.paf-review-section:last-child{border-bottom:none}
.paf-review-heading{display:flex;align-items:center;gap:10px;font-family:var(--serif);font-size:15px;
  margin:0 0 10px;color:var(--ink)}
.paf-readonly-tag{font-family:var(--sans);font-size:10px;font-weight:600;color:var(--meta);
  background:var(--rose-soft);padding:2px 8px;border-radius:999px}
.paf-edit-link{margin-left:auto;background:none;border:none;color:var(--teal-dk);font-family:var(--sans);
  font-size:12px;font-weight:600;cursor:pointer;padding:0}
.paf-summary-row{display:flex;justify-content:space-between;gap:16px;font-size:13px;padding:4px 0}
.paf-summary-row-block{flex-direction:column;gap:6px}
.paf-summary-label{color:var(--meta)}
.paf-summary-value{color:var(--ink);font-weight:600;text-align:right}
.paf-summary-row-block .paf-summary-value{text-align:left;font-weight:400}
.paf-rider-list{margin:0;padding-left:18px}
.paf-na{color:var(--meta);font-weight:400;font-style:italic}
.paf-confirmation{text-align:center}
.paf-confirm-icon{width:52px;height:52px;line-height:52px;border-radius:50%;background:var(--teal);
  color:#fff;font-size:24px;margin:0 auto 16px}
.paf-confirm-note{font-size:12px;color:var(--meta);max-width:480px;margin:0 auto 20px}
.paf-confirm-details{text-align:left;margin-top:16px}
.paf-confirm-details summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--teal-dk)}
.paf-confirm-json{background:#f7f7f7;border:1px solid var(--line);border-radius:8px;padding:14px;
  font-size:11px;overflow-x:auto;text-align:left}
@media (max-width:640px){
  .paf-fields{grid-template-columns:1fr}
  .paf-shell{padding:20px 16px}
}

/* File upload control (Documents step) */
.paf-file-field{grid-column:1/-1}
.paf-upload{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1.5px dashed var(--line);
  border-radius:10px;cursor:pointer;background:var(--rose-soft);transition:border-color .15s ease}
.paf-upload:hover{border-color:var(--teal)}
.paf-upload-done{border-style:solid;border-color:var(--teal);background:#f2faf9}
.paf-upload-icon{width:32px;height:32px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:#E9F5F5;color:var(--teal);font-size:15px;font-weight:700}
.paf-upload-done .paf-upload-icon{background:var(--teal);color:#fff}
.paf-upload-text{font-size:13px;color:var(--ink);word-break:break-all}
.paf-upload-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}

/* Plan Selection cards - built from the agent's real generated quotation(s) */
.paf-plan-cards{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.paf-plan-card{position:relative;border:2px solid var(--line);border-radius:12px;padding:16px;cursor:pointer;
  transition:all .15s ease;background:#fff}
.paf-plan-card:hover{border-color:var(--teal)}
.paf-plan-card-picked{border-color:var(--teal);background:#f2faf9;box-shadow:0 6px 18px rgba(23,141,147,.15)}
.paf-plan-badge{position:absolute;top:-10px;left:14px;background:linear-gradient(90deg,var(--gold-a),var(--gold-b));
  color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 10px;border-radius:999px}
.paf-plan-name{font-weight:600;font-size:13px;margin-top:4px}
.paf-plan-price{font-family:var(--serif);font-size:19px;color:var(--teal);margin-top:8px}
.paf-plan-price small{font-family:var(--sans);font-size:11px;color:var(--meta);font-weight:400}
.paf-plan-meta{font-size:11px;color:var(--meta);margin-top:6px}
.paf-plan-empty{grid-column:1/-1;font-size:13px;color:var(--meta);font-style:italic}

/* A "Continue Application" button (or the live form itself) makes no
   sense on a printed/PDF-exported copy - nothing on paper is clickable,
   and an unstyled/greyed-out button there just looks broken. Found via
   an actual PDF export: it showed up on its own near-blank final page. */
@media print {
  .paf-cta, #paf-app-root, .pq-print-fab { display: none !important; }
}

/* Phase 9: a published quotation (served from GET /q/:id or /app/:id) is
   the ONLY thing on the page - there is no surrounding agent-tool chrome
   with its own Print/Save-as-PDF button (see browser-tool/index.html's
   #print-btn) to fall back on, so the document needs its own. Same
   window.print() mechanism the agent tool's own button already uses
   elsewhere - this project has never had a real PDF-generation library,
   "print to PDF" via the browser's own dialog is the one PDF story
   throughout. Deliberately understated (bottom-right, small) so it reads
   as a utility control, not a second competing call-to-action next to
   "Continue Application". */
.pq-print-fab{position:fixed;bottom:16px;right:16px;z-index:40;background:rgba(11,37,69,.85);color:#fff;
  border:none;border-radius:100px;padding:10px 16px;font-family:var(--sans,-apple-system,sans-serif);
  font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 16px rgba(11,37,69,.3)}
.pq-print-fab:hover{filter:brightness(1.1)}
`;

/**
 * "class=\"sheet\"" was the old medical-card renderer's marker. The new
 * narrative renderer (renderer/renderNarrativeQuotation.js) wraps its
 * whole document in `<div id="pq-doc">` instead - see that file's header.
 * Checking for either keeps this module working during the transition and
 * against any output still produced by the old template's code path.
 */
function isRealQuotation(html) {
  return typeof html === 'string' && (html.includes('class="sheet"') || html.includes('id="pq-doc"'));
}

/**
 * The narrative renderer already supplies its own visible
 * `id="paf-continue-btn"` trigger (its "Send My Details"/"Continue
 * Application" button at the bottom of the page, styled to match its own
 * design) - see renderContactSection() in renderNarrativeQuotation.js.
 * Only the OLD medical-card template needs this module to inject a
 * generic fallback button, to avoid two redundant CTAs stacked one after
 * another.
 */
function hasOwnContinueButton(html) {
  return typeof html === 'string' && html.includes('id="paf-continue-btn"');
}

/**
 * @param {string} quotationHtml the exact output of renderer/renderQuotation.js's renderClientQuotationHtml()
 * @param {object} prefillData the object built by buildPrefillData.js
 * @returns {string} the same document with the client application workflow appended
 */
function composeClientDocument(quotationHtml, prefillData) {
  if (!isRealQuotation(quotationHtml)) return quotationHtml;

  const runtimeSource = typeof __APPLICATION_RUNTIME_SOURCE__ !== 'undefined' ? __APPLICATION_RUNTIME_SOURCE__ : '';
  const prefillJson = JSON.stringify(prefillData || {}).replace(/</g, '\\u003c');
  const continueButtonHtml = hasOwnContinueButton(quotationHtml)
    ? ''
    : '<button type="button" id="paf-continue-btn" class="paf-cta">Continue Application &rarr;</button>';

  return `${quotationHtml}
<style>${APPLICATION_STYLE}</style>
${continueButtonHtml}
<button type="button" id="pq-print-btn" class="pq-print-fab">Print / Save as PDF</button>
<div id="paf-app-root" class="paf-app-root" hidden></div>
<script type="application/json" id="paf-prefill-data">${prefillJson}</script>
<script>${runtimeSource}</script>
<script>
(function () {
  var root = document.getElementById('paf-app-root');
  var dataEl = document.getElementById('paf-prefill-data');
  var prefill = {};
  try { prefill = JSON.parse(dataEl.textContent); } catch (e) {}
  if (root && typeof window.__prubsnInitApplicationFlow === 'function') {
    window.__prubsnInitApplicationFlow(root, prefill);
  }
  var printBtn = document.getElementById('pq-print-btn');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
})();
</script>
`;
}

module.exports = { composeClientDocument };
