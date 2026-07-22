/**
 * renderComparison.js
 *
 * Side-by-side comparison of 2-3 quotations, following the exact same
 * two-mode / gating design as renderQuotation.js (which this module
 * depends on only for `SHARED_STYLE` and `renderBlockedHtml` - no other
 * coupling). Consumes ONLY an array of `{ data, warnings, errors }`
 * objects, one per uploaded PDF; contains no parsing logic.
 *
 * Only ever meaningful for 2 or 3 quotations - the caller (app.js) is
 * responsible for never invoking this at all when exactly one quotation
 * was generated (see docs/ARCHITECTURE.md's comparison-logic section).
 * With one input it would degrade to a a single-column, no-highlight
 * table, which is simply pointless UI, not an error - so this module
 * itself doesn't special-case or reject that input.
 *
 * Same client-safety contract as renderClientQuotationHtml: refuses to
 * render (falls back to renderBlockedHtml) unless every quotation has no
 * errors and the agent has acknowledged all of them, and never shows a
 * "missing"/warning flag - gaps read as calm "Refer to certificate" text.
 */

'use strict';

const { getAgentConfig } = require('../parser/agents');
const {
  escapeHtml,
  formatMoney,
  formatMoneyFixed2,
  resolveMonthlyTotalPayable,
  coPaymentAmount,
  compactRate,
  primaryValue,
} = require('./formatters');
const { renderBlockedHtml, SHARED_STYLE } = require('./renderQuotation');
const { getCoverageStrategy } = require('../parser/coverageStrategy');

const COMPARISON_STYLE = `
  .cmp-wrap{width:100%;max-width:${'1000px'};background:var(--card);border-radius:16px;
    box-shadow:0 22px 60px -26px rgba(23,141,147,.4);overflow:hidden;margin-top:18px}
  .cmp-head{padding:22px 30px 16px;text-align:center;border-bottom:3px solid transparent;
    border-image:linear-gradient(90deg,var(--gold-a),var(--gold-b)) 1}
  .cmp-head h2{font-family:var(--serif);color:var(--teal);font-size:19px;margin:0}
  .cmp-head p{font-size:12px;color:var(--meta);margin:5px 0 0}
  .cmp-body{padding:20px 26px 30px;overflow-x:auto}
  table.cmp{width:100%;border-collapse:collapse;font-size:12.5px;min-width:480px}
  table.cmp th, table.cmp td{padding:10px 12px;border-bottom:1px solid #f3eef1;text-align:left;vertical-align:top}
  table.cmp thead th{font-family:var(--serif);color:var(--teal-dk);font-size:13.5px;border-bottom:2px solid var(--line)}
  table.cmp tbody th{color:#555;font-weight:600;white-space:nowrap}
  table.cmp td{color:#333}
  table.cmp td.cmp-best{color:var(--teal-dk);font-weight:700;background:rgba(23,141,147,.06);border-radius:6px}
  table.cmp td.cmp-best::after{content:" \\2713";color:var(--teal)}
  .cmp-plan-name{font-family:var(--serif);font-size:13.5px;color:var(--ink)}
  .cmp-plan-sub{font-size:10.5px;color:var(--meta);margin-top:2px}
  h3.cmp-sec{font-family:var(--serif);color:var(--teal);font-size:14px;margin:26px 0 8px}
  .cmp-note{margin-top:20px;background:#fff8ec;border:1px solid #f3d8a0;border-radius:10px;
    padding:11px 14px;font-size:11px;color:#7a5a12;line-height:1.6}

  .cmp-toggle-wrap{margin-bottom:22px;padding:14px 16px;background:#f7fbfb;border:1px solid var(--line);border-radius:10px}
  .cmp-toggle-label{font-family:var(--serif);font-size:13px;font-weight:600;color:var(--teal-dk)}
  .cmp-toggle-options{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px}
  .cmp-toggle-option{display:flex;align-items:center;gap:6px;font-size:12px;color:#444;cursor:pointer}
  .cmp-toggle-option input{cursor:pointer}
  td.cmp-col-recommended{background:rgba(23,141,147,.1)!important;box-shadow:inset 0 0 0 1px rgba(23,141,147,.35)}

  .cmp-education{margin-top:8px}
  .cmp-education-intro{font-size:12px;color:var(--meta);margin:4px 0 14px;line-height:1.6}
  .cmp-education-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
  .cmp-education-card{background:#fafafa;border:1px solid #f0eaec;border-radius:10px;padding:16px}
  .cmp-education-title{font-family:var(--serif);color:var(--ink);font-size:14px;font-weight:600;margin-bottom:10px}
  .cmp-education-row{margin-top:10px}
  .cmp-education-row b{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--teal-dk)}
  .cmp-education-row p{font-size:12px;color:#444;line-height:1.55;margin:3px 0 0}
`;

function textOr(value, clientText) {
  return value ? escapeHtml(value) : `<span class="na">${escapeHtml(clientText || 'Refer to certificate')}</span>`;
}

function money(n) {
  const formatted = formatMoney(n);
  return formatted == null ? `<span class="na">Refer to certificate</span>` : `RM ${formatted}`;
}

/** "Monthly Total Amount Payable" always renders with exactly 2 decimal places - see formatters.js's formatMoneyFixed2. */
function moneyFixed2(n) {
  const formatted = formatMoneyFixed2(n);
  return formatted == null ? `<span class="na">Refer to certificate</span>` : `RM ${formatted}`;
}

/** Index of the numerically-lowest value in `values` (nulls ignored); null if none are numeric or there's a tie. */
function indexOfLowest(values) {
  const numeric = values.map((v, i) => ({ v, i })).filter((x) => Number.isFinite(x.v));
  if (numeric.length < 2) return null;
  const min = Math.min(...numeric.map((x) => x.v));
  const winners = numeric.filter((x) => x.v === min);
  return winners.length === 1 ? winners[0].i : null;
}

// Every helper below reads only data.medical (product-agnostic - see
// parser/normalize/toMedicalJson.js), never a product-specific field name
// or benefit-item label string - the same AnugerahMax-vs-Asas360 label
// mismatch this file used to have (e.g. "Hospital Daily Room and Board"
// vs "Hospital Daily Room & Board") is exactly why comparing across
// products needs the normalized schema, not a hardcoded label match.

function planLabel(data) {
  const medical = (data && data.medical) || {};
  return medical.planName || null;
}

function planSubtitle(data) {
  const metadata = (data && data.metadata) || {};
  const medical = (data && data.medical) || {};
  return [metadata.productName, medical.coPayment].filter(Boolean).join(' · ') || null;
}

function roomBoardValue(data) {
  const roomAndBoard = (data && data.medical && data.medical.roomAndBoard) || {};
  if (roomAndBoard.amount == null) return null;
  return compactRate(`RM${roomAndBoard.amount} per day`);
}

/** Union of every benefit label across all quotations, in first-seen order, so a benefit unique to one option still gets its own row. */
function unionBenefitLabels(allData) {
  const seen = new Set();
  const labels = [];
  for (const data of allData) {
    const items = (data && data.medical && data.medical.benefitItems) || [];
    for (const item of items) {
      if (!seen.has(item.label)) {
        seen.add(item.label);
        labels.push(item.label);
      }
    }
  }
  return labels;
}

function benefitValueFor(data, label) {
  const items = (data && data.medical && data.medical.benefitItems) || [];
  const item = items.find((i) => i.label === label);
  return item ? primaryValue(item.value) : null;
}

/** True if every quotation has the same value for a benefit row - those rows are still shown (completeness), just without a "best" highlight (there's no single "better" for a same-value row). */
function allEqual(values) {
  return values.every((v) => v === values[0]);
}

/** Falls back to a product's own directly-printed top-level monthly/annual figure (Asas360's `data.monthlyTotalAmountPayable`/`data.totalAnnualContribution`) when resolveMonthlyTotalPayable()'s AnugerahMax-shaped `contributions` object has nothing - never derived/estimated for either product. */
function monthlyFor(d) {
  const fromContributions = resolveMonthlyTotalPayable((d && d.contributions) || {});
  if (fromContributions != null) return fromContributions;
  return d && d.monthlyTotalAmountPayable != null ? d.monthlyTotalAmountPayable : null;
}
function annualFor(d) {
  const fromContributions = (d && d.contributions && d.contributions.totalAnnualContribution) || null;
  if (fromContributions != null) return fromContributions;
  return d && d.totalAnnualContribution != null ? d.totalAnnualContribution : null;
}

function renderKeyFiguresTable(allData, headerCells) {
  const monthly = allData.map(monthlyFor);
  const annual = allData.map(annualFor);
  const bestMonthly = indexOfLowest(monthly);
  const bestAnnual = indexOfLowest(annual);
  const col = (i) => ` data-col="${i}"`;

  const planRow = `<tr><th>Plan</th>${allData.map((d, i) => `<td${col(i)}><div class="cmp-plan-name">${textOr(planLabel(d))}</div><div class="cmp-plan-sub">${escapeHtml(planSubtitle(d) || '')}</div></td>`).join('')}</tr>`;
  const monthlyRow = `<tr><th>Monthly Total Amount Payable</th>${allData.map((d, i) => `<td${col(i)}${i === bestMonthly ? ' class="cmp-best"' : ''}>${moneyFixed2(monthly[i])}</td>`).join('')}</tr>`;
  const annualRow = `<tr><th>Annual Contribution</th>${allData.map((d, i) => `<td${col(i)}${i === bestAnnual ? ' class="cmp-best"' : ''}>${money(annual[i])}</td>`).join('')}</tr>`;
  const roomBoardRow = `<tr><th>Room &amp; Board</th>${allData.map((d, i) => `<td${col(i)}>${textOr(roomBoardValue(d))}</td>`).join('')}</tr>`;
  const coverageModelRow = `<tr><th>Coverage Model</th>${allData.map((d, i) => {
    const model = (d.medical || {}).coverageModel;
    return `<td${col(i)}>${textOr(model === 'LIFETIME_MEDICAL_FUND' ? 'Lifetime Medical Fund' : model === 'ANNUAL_LIMIT' ? 'Annual Limit' : null)}</td>`;
  }).join('')}</tr>`;
  const annualLimitRow = `<tr><th>Annual Limit</th>${allData.map((d, i) => `<td${col(i)}>${textOr((d.medical || {}).annualLimit)}</td>`).join('')}</tr>`;
  // Shows the real Smart Value Point figure (e.g. "RM1,000,000") alongside
  // the descriptive lifetimeLimit text ("No Limit, subject to SVP") -
  // previously only the description was shown, never the actual number a
  // client would want to compare between options.
  const lifetimeLimitRow = `<tr><th>Lifetime Medical Fund</th>${allData.map((d, i) => {
    const medical = d.medical || {};
    const amount = medical.lifetimeFundAmount != null ? money(medical.lifetimeFundAmount) : null;
    return `<td${col(i)}>${textOr(medical.lifetimeLimit)}${amount ? `<div class="cmp-plan-sub">${amount}</div>` : ''}</td>`;
  }).join('')}</tr>`;
  const coPayRow = `<tr><th>Co-payment</th>${allData.map((d, i) => {
    const opt = (d.medical || {}).coPayment;
    const amt = coPaymentAmount(opt);
    return `<td${col(i)}>${textOr(opt)}${amt ? `<div class="cmp-plan-sub">RM ${escapeHtml(amt)} per disability</div>` : ''}</td>`;
  }).join('')}</tr>`;
  const coverageRow = `<tr><th>Coverage Term</th>${allData.map((d, i) => `<td${col(i)}>${(d.medical || {}).coverageToAge != null ? `to Age ${(d.medical || {}).coverageToAge}` : `<span class="na">Refer to certificate</span>`}</td>`).join('')}</tr>`;

  return `
    <table class="cmp">
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${planRow}${monthlyRow}${annualRow}${roomBoardRow}${coverageModelRow}${annualLimitRow}${lifetimeLimitRow}${coPayRow}${coverageRow}</tbody>
    </table>`;
}

function renderBenefitsTable(allData, headerCells) {
  const labels = unionBenefitLabels(allData);
  if (!labels.length) return '';
  const rows = labels.map((label) => {
    const values = allData.map((d) => benefitValueFor(d, label));
    const differs = !allEqual(values);
    return `<tr><th>${escapeHtml(label)}</th>${values.map((v, i) => `<td data-col="${i}"${differs && v ? ' class="cmp-best"' : ''}>${textOr(v)}</td>`).join('')}</tr>`;
  }).join('');
  return `
    <h3 class="cmp-sec">Benefit-by-benefit comparison</h3>
    <table class="cmp"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * "Choose Your Recommended Plan" - a client-side-only toggle (no data is
 * sent anywhere) that highlights one option's column across every table
 * on the page, via the small runtime script below. Always shown for 2-3
 * real, actually-uploaded quotations - never a hypothetical single-PDF
 * toggle (see the plan's explicit scoping decision).
 */
function renderPlanToggle(allData) {
  const options = allData
    .map(
      (d, i) => `
      <label class="cmp-toggle-option">
        <input type="radio" name="cmp-recommend" value="${i}"${i === 0 ? ' checked' : ''}>
        <span>${textOr(planLabel(d), `Option ${i + 1}`)}</span>
      </label>`
    )
    .join('');
  return `
  <div class="cmp-toggle-wrap">
    <div class="cmp-toggle-label">Choose Your Recommended Plan</div>
    <div class="cmp-toggle-options">${options}</div>
  </div>`;
}

const COMPARISON_RUNTIME = `
(function () {
  var radios = document.querySelectorAll('input[name="cmp-recommend"]');
  if (!radios.length) return;
  function apply(selected) {
    document.querySelectorAll('td[data-col]').forEach(function (td) {
      td.classList.toggle('cmp-col-recommended', td.getAttribute('data-col') === selected);
    });
  }
  radios.forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) apply(r.value); });
  });
  var checked = document.querySelector('input[name="cmp-recommend"]:checked');
  if (checked) apply(checked.value);
})();
`;

/**
 * Coverage models aren't just different numbers - they're two different
 * ways of paying claims. When the compared options don't all share the
 * same data.medical.coverageModel, this block explains the difference
 * using only coverageStrategy.js's real, exact wording plus each option's
 * own real figures - never a fabricated comparison for a plan that wasn't
 * actually quoted.
 */
function renderCrossProductEducation(allData) {
  const models = allData.map((d) => (d.medical || {}).coverageModel).filter(Boolean);
  const distinctModels = [...new Set(models)];
  if (distinctModels.length < 2) return '';

  const cards = allData.map((d, i) => {
    const medical = d.medical || {};
    const strategy = getCoverageStrategy(medical.coverageModel);
    const isLifetime = medical.coverageModel === 'LIFETIME_MEDICAL_FUND';
    const sharing = medical.costSharingAfterExhaustion;
    const label = planLabel(d) || `Option ${i + 1}`;
    const howClaimsArePaid = isLifetime
      ? `Claims are paid from your ${medical.lifetimeLimit || 'lifetime medical fund'} until it's used up${sharing ? `, then an ${sharing.insurerPct}% (PruBSN) / ${sharing.clientPct}% (you) cost-sharing arrangement applies` : ''}.`
      : `Claims are paid up to your ${medical.annualLimit || 'annual limit'}, which refreshes in full every policy year.`;
    const advantages = isLifetime
      ? 'Unused cover carries forward - nothing resets or is lost at the end of a policy year.'
      : 'A completely fresh limit every year, with no risk of a lifetime pool running out.';
    const disadvantages = isLifetime
      ? "The fund is finite - very large or repeated claims over time draw it down, after which you share part of the cost."
      : "The limit doesn't carry forward - it simply resets each year, so unused cover isn't banked for later.";
    const suitableFor = isLifetime
      ? 'Clients who want one lasting pool of cover and are comfortable with shared costs once it is used up.'
      : 'Clients who want a predictable, fully-refreshed limit every single year.';
    return `
      <div class="cmp-education-card">
        <div class="cmp-education-title">${escapeHtml(label)}</div>
        <div class="cmp-education-row"><b>Coverage structure</b><p>${textOr(strategy && strategy.explanation)}</p></div>
        <div class="cmp-education-row"><b>How claims are paid</b><p>${escapeHtml(howClaimsArePaid)}</p></div>
        <div class="cmp-education-row"><b>Advantages</b><p>${escapeHtml(advantages)}</p></div>
        <div class="cmp-education-row"><b>Disadvantages</b><p>${escapeHtml(disadvantages)}</p></div>
        <div class="cmp-education-row"><b>Suitable client profile</b><p>${escapeHtml(suitableFor)}</p></div>
      </div>`;
  });

  return `
  <div class="cmp-education">
    <h3 class="cmp-sec">Understanding the difference</h3>
    <p class="cmp-education-intro">These options use two different ways of paying claims, not just different numbers. Here's what that means for you:</p>
    <div class="cmp-education-grid">${cards.join('')}</div>
    <div class="cmp-note"><b>Important considerations.</b> Neither coverage structure is universally better - the right choice depends on your own risk tolerance, budget, and how you weigh predictability against a lasting pool of cover. Please discuss with your agent before deciding.</div>
  </div>`;
}

function comparisonCard(allData) {
  const clientName = (allData[0] && allData[0].client && allData[0].client.fullName) || null;
  const agentConfig = getAgentConfig(allData[0] && allData[0].agent && allData[0].agent.agentCode) || {};
  const headerCells = allData.map((d, i) => `<th>${escapeHtml(`Option ${i + 1}`)}</th>`).join('');
  return `
<div class="cmp-wrap">
  <div class="cmp-head">
    <h2>Comparing ${allData.length} Options</h2>
    <p>${clientName ? `Prepared for ${escapeHtml(clientName)}` : 'Prepared for you'}${agentConfig.name ? ` by ${escapeHtml(agentConfig.name)}` : ''}</p>
  </div>
  <div class="cmp-body">
    ${renderPlanToggle(allData)}
    ${renderKeyFiguresTable(allData, headerCells)}
    ${renderBenefitsTable(allData, headerCells)}
    ${renderCrossProductEducation(allData)}
    <div class="cmp-note"><b>Please note.</b> Figures above are illustrations, not a contract of takaful, and are subject to underwriting approval by Prudential BSN Takaful Berhad. The highlighted option in each row is the lower contribution amount only - it does not account for coverage differences shown in the benefits table below it.</div>
  </div>
</div>`;
}

function documentShell(title, bodyHtml) {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${SHARED_STYLE}${COMPARISON_STYLE}</style>
<body style="display:flex;flex-direction:column;align-items:center">
${bodyHtml}
<script>${COMPARISON_RUNTIME}</script>
</body>`;
}

/**
 * @param {{data: object, warnings: object[], errors: object[]}[]} parseResults 2 or 3 parsed quotations, in display order
 * @param {{acknowledged?: boolean}[]} agentReviews one per quotation, same order/length as parseResults - each must be acknowledged
 * @returns {string} full standalone HTML document
 */
function renderComparisonHtml(parseResults, agentReviews) {
  const results = parseResults || [];
  const reviews = agentReviews || [];

  const blockingErrors = [];
  results.forEach((r, i) => {
    if (r && r.errors && r.errors.length) {
      blockingErrors.push(...r.errors.map((e) => `Option ${i + 1} - ${e.field}: ${e.message}`));
    }
    if (!reviews[i] || !reviews[i].acknowledged) {
      blockingErrors.push(`Option ${i + 1} has not been reviewed and acknowledged by the agent yet.`);
    }
  });
  if (blockingErrors.length) {
    return renderBlockedHtml(blockingErrors);
  }

  const allData = results.map((r) => r.data);
  return documentShell(`Comparing ${allData.length} Options`, comparisonCard(allData));
}

module.exports = { renderComparisonHtml };
