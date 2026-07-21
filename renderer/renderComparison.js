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

function planLabel(data) {
  const plan = (data && data.plan) || {};
  return [plan.medicalRiderName, plan.medicalPlanTier].filter(Boolean).join(' ') || null;
}

function planSubtitle(data) {
  const metadata = (data && data.metadata) || {};
  const plan = (data && data.plan) || {};
  return [metadata.productName, plan.coPaymentOption].filter(Boolean).join(' · ') || null;
}

function roomBoardValue(data) {
  const items = (data && data.benefits && data.benefits.benefitItems) || [];
  const item = items.find((i) => i.label === 'Hospital Daily Room and Board');
  return item ? compactRate(item.value) : null;
}

/** Union of every benefit label across all quotations, in first-seen order, so a benefit unique to one option still gets its own row. */
function unionBenefitLabels(allData) {
  const seen = new Set();
  const labels = [];
  for (const data of allData) {
    const items = (data && data.benefits && data.benefits.benefitItems) || [];
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
  const items = (data && data.benefits && data.benefits.benefitItems) || [];
  const item = items.find((i) => i.label === label);
  return item ? primaryValue(item.value) : null;
}

/** True if every quotation has the same value for a benefit row - those rows are still shown (completeness), just without a "best" highlight (there's no single "better" for a same-value row). */
function allEqual(values) {
  return values.every((v) => v === values[0]);
}

function renderKeyFiguresTable(allData) {
  const monthly = allData.map((d) => resolveMonthlyTotalPayable(d.contributions || {}));
  const annual = allData.map((d) => (d.contributions || {}).totalAnnualContribution);
  const bestMonthly = indexOfLowest(monthly);
  const bestAnnual = indexOfLowest(annual);

  const headerCells = allData.map((d, i) => `<th>${escapeHtml(`Option ${i + 1}`)}</th>`).join('');
  const planRow = `<tr><th>Plan</th>${allData.map((d) => `<td><div class="cmp-plan-name">${textOr(planLabel(d))}</div><div class="cmp-plan-sub">${escapeHtml(planSubtitle(d) || '')}</div></td>`).join('')}</tr>`;
  const monthlyRow = `<tr><th>Monthly Total Amount Payable</th>${allData.map((d, i) => `<td${i === bestMonthly ? ' class="cmp-best"' : ''}>${moneyFixed2(monthly[i])}</td>`).join('')}</tr>`;
  const annualRow = `<tr><th>Annual Contribution</th>${allData.map((d, i) => `<td${i === bestAnnual ? ' class="cmp-best"' : ''}>${money(annual[i])}</td>`).join('')}</tr>`;
  const roomBoardRow = `<tr><th>Room &amp; Board</th>${allData.map((d) => `<td>${textOr(roomBoardValue(d))}</td>`).join('')}</tr>`;
  const annualLimitRow = `<tr><th>Annual Limit</th>${allData.map((d) => `<td>${textOr((d.benefits || {}).annualLimit)}</td>`).join('')}</tr>`;
  const lifetimeLimitRow = `<tr><th>Lifetime Limit</th>${allData.map((d) => `<td>${textOr((d.benefits || {}).lifetimeLimit)}</td>`).join('')}</tr>`;
  const coPayRow = `<tr><th>Co-payment</th>${allData.map((d) => {
    const opt = (d.plan || {}).coPaymentOption;
    const amt = coPaymentAmount(opt);
    return `<td>${textOr(opt)}${amt ? `<div class="cmp-plan-sub">RM ${escapeHtml(amt)} per disability</div>` : ''}</td>`;
  }).join('')}</tr>`;
  const coverageRow = `<tr><th>Coverage Term</th>${allData.map((d) => `<td>${(d.plan || {}).coverageToAge != null ? `to Age ${(d.plan || {}).coverageToAge}` : `<span class="na">Refer to certificate</span>`}</td>`).join('')}</tr>`;

  return `
    <table class="cmp">
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${planRow}${monthlyRow}${annualRow}${roomBoardRow}${annualLimitRow}${lifetimeLimitRow}${coPayRow}${coverageRow}</tbody>
    </table>`;
}

function renderBenefitsTable(allData) {
  const labels = unionBenefitLabels(allData);
  if (!labels.length) return '';
  const headerCells = allData.map((d, i) => `<th>${escapeHtml(`Option ${i + 1}`)}</th>`).join('');
  const rows = labels.map((label) => {
    const values = allData.map((d) => benefitValueFor(d, label));
    const differs = !allEqual(values);
    return `<tr><th>${escapeHtml(label)}</th>${values.map((v) => `<td${differs && v ? ' class="cmp-best"' : ''}>${textOr(v)}</td>`).join('')}</tr>`;
  }).join('');
  return `
    <h3 class="cmp-sec">Benefit-by-benefit comparison</h3>
    <table class="cmp"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
}

function comparisonCard(allData) {
  const clientName = (allData[0] && allData[0].client && allData[0].client.fullName) || null;
  const agentConfig = getAgentConfig(allData[0] && allData[0].agent && allData[0].agent.agentCode) || {};
  return `
<div class="cmp-wrap">
  <div class="cmp-head">
    <h2>Comparing ${allData.length} Options</h2>
    <p>${clientName ? `Prepared for ${escapeHtml(clientName)}` : 'Prepared for you'}${agentConfig.name ? ` by ${escapeHtml(agentConfig.name)}` : ''}</p>
  </div>
  <div class="cmp-body">
    ${renderKeyFiguresTable(allData)}
    ${renderBenefitsTable(allData)}
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
