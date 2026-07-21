/**
 * renderQuotation.js
 *
 * Phase 2: the renderer. Consumes ONLY the `{ data, warnings, errors }`
 * object returned by parser/parseQuotation.js (plus, deliberately, the
 * AGENTS config via getAgentConfig - agent contact details are config,
 * not PDF data, per the Phase 1 design). It contains no PDF parsing
 * logic: no anchors, no page/line scanning, no regex used to locate
 * anything in raw PDF text. The only regex/string work here is display
 * formatting of values that are already structured data (formatters.js).
 *
 * The visual design (markup + CSS) is lifted from the existing
 * ../../medical-card-quotation.html rather than rebuilt.
 *
 * --- Two render modes, two very different audiences ---
 *
 * `renderAgentReviewHtml(parseResult)` - INTERNAL ONLY. Shows every
 * warning and error inline (a banner up top, plus inline red flags on
 * whichever field triggered them - merged benefit-table cells, the
 * low-confidence option product name, an unassigned quotation number,
 * etc). This is what an agent looks at to decide whether a quotation is
 * fit to send. It must never be the thing that gets emailed to a client.
 *
 * `renderClientQuotationHtml(parseResult, agentReview)` - the
 * client-safe document. It:
 *   - refuses to render at all (returns a plain "not ready" notice
 *     instead of a quotation) if `parseResult.errors` is non-empty, or if
 *     the caller hasn't passed `agentReview.acknowledged: true` - there is
 *     no way to bypass this from the data alone, which is the point
 *   - never shows a warning, a "missing" flag, or any wording that
 *     reveals the parsing/extraction process happened at all - gaps show
 *     up as neutral, calm phrasing ("Refer to certificate") instead
 *   - only shows "Quotation No" if `agentReview.quotationNumber` was
 *     explicitly supplied (never the parser's empty placeholder)
 *   - only shows "Valid until" if `agentReview.validUntilIso` was
 *     explicitly supplied (never the parser's auto-generated date)
 *   - adds the client-facing provenance line ("Interactive quotation
 *     prepared from the PruBSN Product Illustration dated ...")
 *   - never mentions software/parser version - that's not in this
 *     template at all, agent or client
 */

'use strict';

const { getAgentConfig } = require('../parser/agents');
const {
  escapeHtml,
  formatMoney,
  formatDateLong,
  coPaymentAmount,
  compactRate,
  bareTierNumber,
  primaryValue,
} = require('./formatters');

/** Extracts a "(N days ...)" style parenthetical out of a benefit value, for the little tag badge. */
function extractDayTag(value) {
  if (!value) return null;
  const m = value.match(/\(([^)]*\bdays?\b[^)]*)\)/i);
  return m ? m[1] : null;
}

function formatLimitPhrase(limit) {
  if (!limit) return null;
  if (/no\s*(annual\s*)?limit/i.test(limit)) return 'no annual limit';
  return `${limit} limit`;
}

function optionBadge(index, columns) {
  if (index === 0) return 'Recommended';
  const recommended = columns[0] && columns[0].annualContribution;
  const current = columns[index].annualContribution;
  if (recommended != null && current != null) {
    if (current < recommended) return 'Lower cost';
    if (current > recommended) return 'Higher cover';
  }
  return `Option ${index}`;
}

/**
 * Every "value not found" fallback in the template goes through here.
 * This is the single place that decides what an absent value looks like
 * - and therefore the single place a reviewer needs to check to be sure
 * nothing diagnostic ever reaches a client. Agent mode explains *why*
 * (red, explicit); client mode says nothing is wrong, just point them at
 * the certificate (calm, standard insurance-document phrasing, no
 * invented number).
 */
function buildHelpers(mode) {
  function missing(agentMessage, clientText) {
    if (mode === 'agent') {
      return `<span class="missing">— ${escapeHtml(agentMessage || 'not found in PDF - please confirm')} —</span>`;
    }
    // "Refer to certificate" is the right default when a caller omits
    // clientText entirely (most calls - a benefit figure, a plan detail,
    // something the client's actual certificate genuinely does contain).
    // It's wrong for a caller that explicitly passes '' meaning "there is
    // nothing to show here" (e.g. the footer's dealership line, when the
    // agent's config has none on file) - a certificate has no
    // "dealership" section to refer to. `??` (not `||`) so an explicit
    // '' is honoured as "render nothing" instead of being coerced to the
    // generic fallback phrase.
    return `<span class="na">${escapeHtml(clientText ?? 'Refer to certificate')}</span>`;
  }
  function money(n, opts = {}) {
    const formatted = formatMoney(n);
    if (formatted == null) return missing(opts.agentMessage || 'amount not found', opts.clientText);
    return `RM ${formatted}`;
  }
  function textOr(value, agentMessage, clientText) {
    return value ? escapeHtml(value) : missing(agentMessage, clientText);
  }
  return { missing, money, textOr };
}

function renderBenefitsTable(benefitItems, helpers) {
  const { missing } = helpers;
  if (!benefitItems || !benefitItems.length) {
    return `<tr><td class="b">${missing('benefits table not found')}</td><td class="v"></td></tr>`;
  }
  return benefitItems
    .map((item) => {
      const tag = extractDayTag(item.value);
      const tagHtml = tag ? ` <span class="tag">${escapeHtml(tag)}</span>` : '';
      const compact = primaryValue(item.value);
      const valueHtml = compact ? escapeHtml(compact) : missing('shares a merged cell in the PDF - verify against the certificate', 'Refer to certificate');
      return `<tr><td class="b">${escapeHtml(item.label)}${tagHtml}</td><td class="v">${valueHtml}</td></tr>`;
    })
    .join('\n');
}

function renderExclusions(exclusions, helpers) {
  if (!exclusions || !exclusions.length) {
    return `<li>${helpers.missing('exclusions not found')}</li>`;
  }
  return exclusions.map((e) => `<li>${escapeHtml(e)}.</li>`).join('\n');
}

function renderOptionCard(col, index, columns, helpers) {
  const { missing, money } = helpers;
  const badge = optionBadge(index, columns);
  const pickClass = index === 0 ? ' pick' : '';
  const name = col.productName ? escapeHtml(col.productName) : missing('product name unclear - reconstructed from a wrapped PDF cell', 'Plan details');
  const price = col.annualContribution != null ? `${money(col.annualContribution)}<small>/yr</small>` : missing();
  const descBits = [
    col.roomAndBoard ? `${escapeHtml(col.roomAndBoard)} room` : null,
    formatLimitPhrase(col.annualLimitOption) ? escapeHtml(formatLimitPhrase(col.annualLimitOption)) : null,
  ].filter(Boolean);
  const desc = descBits.length ? descBits.join(' · ') : missing();

  return `
      <div class="opt${pickClass}">
        <div class="badge">${escapeHtml(badge)}</div>
        <div class="nm">${name}</div>
        <div class="pr">${price}</div>
        <div class="d">${desc}</div>
      </div>`;
}

function renderNote(projection, client) {
  const rows = (projection && projection.projectionRows) || [];
  const currentRow = rows.find((r) => client && r.age === client.ageNextBirthday) || rows[0] || null;
  const age = client ? client.ageNextBirthday : null;
  const amount = currentRow ? formatMoney(currentRow.currentContribution) : null;

  if (age == null || amount == null) {
    return `This is an illustration, not a contract of takaful, and is subject to underwriting approval by Prudential BSN Takaful Berhad. Medic TotalCare contribution is not guaranteed and may rise over time with medical inflation.`;
  }
  return `This is an illustration, not a contract of takaful, and is subject to underwriting approval by Prudential BSN Takaful Berhad. Medic TotalCare contribution is not guaranteed and may rise over time with medical inflation — for example, the annual contribution at age ${age} is around RM ${amount} and is projected to increase as the covered person ages.`;
}

/** Only rendered in agent mode. Lists every warning/error so the agent can act on them before sending anything. */
function renderReviewBanner(warnings, errors) {
  const errorItems = (errors || [])
    .map((e) => `<li><b>${escapeHtml(e.field)}</b> — ${escapeHtml(e.message)}</li>`)
    .join('');
  const warningItems = (warnings || [])
    .map((w) => `<li><b>${escapeHtml(w.field)}</b> — ${escapeHtml(w.message)}</li>`)
    .join('');
  return `
  <div class="review-banner">
    <div class="review-banner-title">⚠ AGENT REVIEW — INTERNAL ONLY. Do not forward this page to a client.</div>
    ${errors && errors.length
      ? `<div class="review-section"><b>${errors.length} required field(s) missing — this quotation CANNOT be sent as-is:</b><ul>${errorItems}</ul></div>`
      : `<div class="review-section review-ok">No required fields are missing.</div>`}
    ${warnings && warnings.length
      ? `<div class="review-section"><b>${warnings.length} warning(s) to check before sending:</b><ul>${warningItems}</ul></div>`
      : `<div class="review-section review-ok">No warnings.</div>`}
  </div>`;
}

const SHARED_STYLE = `
  :root{
    --rose:#F2D3E2; --rose-soft:#faf2f6;
    --teal:#178D93; --teal-dk:#0f6b70;
    --gold-a:#D4AF37; --gold-b:#FDB913;
    --ink:#2b2b2b; --meta:#8a8a8a; --line:#ece2e7; --card:#ffffff;
    --serif:Georgia,"Times New Roman",serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,sans-serif;
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--rose);font-family:var(--sans);color:var(--ink);
    padding:26px 14px 60px;display:flex;flex-direction:column;align-items:center;line-height:1.5}
  .sheet{width:100%;max-width:800px;background:var(--card);border-radius:16px;
    box-shadow:0 22px 60px -26px rgba(23,141,147,.4);overflow:hidden}

  .head{padding:26px 34px 18px;display:flex;align-items:center;gap:14px;
    border-bottom:3px solid transparent;border-image:linear-gradient(90deg,var(--gold-a),var(--gold-b)) 1}
  .mark{width:46px;height:46px;flex:none}
  img.mark{border-radius:14px;object-fit:cover;background:#000}
  .head .co{font-family:var(--serif);font-size:18px;font-weight:700;color:#111;line-height:1.1}
  .head .co small{display:block;font-family:var(--sans);font-size:10.5px;font-weight:400;color:var(--meta);margin-top:3px;letter-spacing:.02em}
  .head .rt{margin-left:auto;text-align:right;font-size:11px;color:var(--meta);line-height:1.7}
  .head .rt b{color:var(--teal-dk)}

  .hero{padding:26px 34px 6px}
  .medcard{position:relative;aspect-ratio:1.586;max-width:420px;margin:0 auto;border-radius:16px;
    background:radial-gradient(120% 140% at 100% 0%,#2a2a2a 0%,#000 55%);color:#fff;
    padding:20px 22px;box-shadow:0 14px 34px -14px rgba(0,0,0,.55);overflow:hidden}
  .medcard::after{content:"";position:absolute;inset:0;border-radius:16px;padding:1.4px;
    background:linear-gradient(135deg,var(--gold-a),var(--gold-b),#8a6d17);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
    -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
  .medcard .brandrow{display:flex;justify-content:space-between;align-items:center}
  .medcard .brandrow .g{font-family:var(--serif);font-weight:700;font-size:13px;
    background:linear-gradient(90deg,var(--gold-a),var(--gold-b));-webkit-background-clip:text;background-clip:text;color:transparent}
  .medcard .type{font-size:9px;letter-spacing:.24em;color:#cbb46a;text-transform:uppercase}
  .medcard .chip{width:34px;height:25px;margin:16px 0 12px;border-radius:5px;
    background:linear-gradient(135deg,#e9cf7a,#b8912f)}
  .medcard .name{font-size:16px;letter-spacing:.03em;font-weight:600;text-transform:uppercase}
  .medcard .foot{display:flex;justify-content:space-between;margin-top:12px;font-size:10px;color:#d9d2c0}
  .medcard .foot .lab{color:#9a8f74;text-transform:uppercase;letter-spacing:.08em;font-size:8px}
  .medcard .foot b{color:#fff;font-size:12px;font-weight:600}

  .titles{text-align:center;padding:20px 34px 4px}
  .titles h1{font-family:var(--serif);color:var(--teal);font-size:22px;margin:0;font-weight:700}
  .titles .plan{font-size:12px;color:var(--meta);letter-spacing:.05em;margin-top:5px}
  .titles .src-note{font-size:10.5px;color:#b3aca6;margin-top:6px;font-style:italic}

  .body{padding:8px 34px 30px}

  .prep{display:flex;flex-wrap:wrap;gap:6px 26px;background:var(--rose-soft);border:1px solid var(--line);
    border-radius:12px;padding:14px 18px;margin:14px 0 22px;font-size:12.5px}
  .prep .item{min-width:140px}
  .prep .k{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--meta)}
  .prep .v{font-weight:600}
  .prep .item.name .v{font-family:var(--serif);font-size:15px}

  .figs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:26px}
  @media(max-width:600px){.figs{grid-template-columns:1fr 1fr}}
  .fig{border:1px solid var(--line);border-radius:12px;padding:14px;position:relative;overflow:hidden}
  .fig::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--gold-a),var(--gold-b))}
  .fig .lab{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--meta)}
  .fig .amt{font-family:var(--serif);font-size:21px;color:var(--teal);font-weight:700;margin-top:5px;line-height:1.05}
  .fig .amt small{font-family:var(--sans);font-size:11px;color:var(--meta);font-weight:400}
  .fig .sub{font-size:10.5px;color:var(--meta);margin-top:2px}

  h2.sec{font-family:var(--serif);color:var(--teal);font-size:15.5px;margin:26px 0 10px;
    padding-bottom:6px;border-bottom:1px solid var(--line)}

  table.ben{width:100%;border-collapse:collapse;font-size:12.5px}
  table.ben td{padding:9px 4px;border-bottom:1px solid #f3eef1;vertical-align:top}
  table.ben td.b{color:#444}
  table.ben td.v{text-align:right;font-weight:600;color:var(--teal-dk);white-space:nowrap;padding-left:14px}
  table.ben tr:last-child td{border-bottom:none}
  .tag{display:inline-block;font-size:9.5px;letter-spacing:.04em;background:rgba(23,141,147,.1);
    color:var(--teal-dk);border-radius:20px;padding:1px 8px;margin-left:6px;vertical-align:middle}

  .contrib{border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .contrib .row{display:flex;justify-content:space-between;padding:10px 16px;font-size:12.5px;border-bottom:1px solid #f3eef1}
  .contrib .row .l{color:#555}
  .contrib .row.total{background:linear-gradient(90deg,rgba(23,141,147,.06),rgba(212,175,55,.12));
    font-family:var(--serif);border-bottom:none}
  .contrib .row.total .l{color:#111;font-size:14px}
  .contrib .row.total .r{font-size:19px;font-weight:700;color:var(--teal)}
  .contrib .row.total .r small{font-family:var(--sans);font-size:11px;color:var(--meta);font-weight:400}

  .opts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  @media(max-width:600px){.opts{grid-template-columns:1fr}}
  .opt{border:1px solid var(--line);border-radius:12px;padding:14px}
  .opt.pick{border-color:var(--teal);box-shadow:0 0 0 2px rgba(23,141,147,.12)}
  .opt .badge{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-dk);font-weight:700}
  .opt .nm{font-weight:600;font-size:12.5px;margin:5px 0 8px}
  .opt .pr{font-family:var(--serif);font-size:17px;color:var(--teal)}
  .opt .pr small{font-family:var(--sans);font-size:11px;color:var(--meta)}
  .opt .d{font-size:10.5px;color:var(--meta);margin-top:6px;line-height:1.5}

  .excl{font-size:12px;color:#555;line-height:1.7}
  .excl li{margin-bottom:3px}

  .note{margin-top:22px;background:#fff8ec;border:1px solid #f3d8a0;border-radius:10px;
    padding:11px 14px;font-size:11.5px;color:#7a5a12;line-height:1.6}

  .foot2{margin-top:26px;text-align:center;font-size:10.5px;color:var(--meta);line-height:1.8;
    border-top:1px solid var(--line);padding-top:16px}
  .foot2 .s{color:var(--ink)}

  /* Agent-mode only: honestly flag data the parser couldn't find, and generated (not extracted) fields. */
  .missing{color:#B3261E;font-style:italic;font-weight:500}
  .gen{border-bottom:1px dashed #C9A227;color:#8a6d1f}
  /* Client-mode only: calm, non-alarming placeholder for anything not shown outright. */
  .na{color:var(--meta);font-style:italic}

  .review-banner{width:100%;max-width:800px;margin-bottom:14px;background:#2a1215;color:#ffd8d4;
    border-radius:12px;padding:16px 20px;font-size:12.5px;line-height:1.6}
  .review-banner-title{font-weight:700;font-size:13.5px;margin-bottom:10px;color:#ff8a80}
  .review-section{margin-top:8px}
  .review-section ul{margin:6px 0 0;padding-left:20px}
  .review-ok{color:#9fd6a3}

  /* ---------- print / save-as-PDF ----------
     Found via an actual printed/PDF-exported quotation, not just on
     screen: with no rules here at all, (1) the medical card's dark
     background and white text are a CSS background, which most browsers
     omit by default when printing without "background graphics" -
     leaving the card a blank white box (the text is white-on-white, not
     just unstyled), and (2) with no page-break hints, a page break can
     land inside the footer block and strand the agent/dealership line
     alone at the top of an otherwise blank final page.

     print-color-adjust is scoped to the specific elements whose CSS
     background carries real information (the medical card, key-figure
     card accents, the contribution total row, the recommended-option
     border, table value colour, day-count tag pills) - keep this list
     explicit and add to it deliberately as the template evolves, rather
     than forcing it everywhere with a catch-all selector.

     .medcard::after is turned off in print rather than added to that
     list: it draws the card's thin gold ring border with a
     mask-composite:exclude trick (a full gradient square masked down to
     just the outer 1.4px), and that mask does not survive Chromium's
     print rendering - forced or not, it paints as a solid, opaque gold
     rectangle covering the *entire* card, hiding the card's own
     background and every line of white text on it. Losing a decorative
     1.4px ring in print is a fair trade for the card actually being
     legible. */
  @media print {
    body{background:#fff;padding:0;display:block}
    .sheet{box-shadow:none;border-radius:0;max-width:100%}
    .medcard::after{content:none}
    .medcard, .medcard .brandrow .g, .fig::before,
    .contrib .row.total, .opt.pick, table.ben td.v, .tag{
      -webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
    .medcard{break-inside:avoid;page-break-inside:avoid}
    .fig, .opt, .contrib{break-inside:avoid;page-break-inside:avoid}
    h2.sec{break-after:avoid;page-break-after:avoid}
    .foot2{break-before:avoid;page-break-before:avoid}
  }
`;

/**
 * @param {object} data the `data` object from parseQuotation()'s
 *   { data, warnings, errors } return value - NOT the whole result
 * @param {'agent'|'client'} mode
 * @param {object} agentReview only meaningful in client mode - see
 *   renderClientQuotationHtml
 * @returns {string} the .sheet card's inner content (caller wraps it in a full document)
 */
function renderQuotationCard(data, mode, agentReview = {}) {
  const { metadata = {}, client = {}, agent = {}, plan = {}, contributions = {}, benefits = {}, options = {}, projection = {} } = data || {};
  const helpers = buildHelpers(mode);
  const { missing, money, textOr } = helpers;
  const agentConfig = getAgentConfig(agent.agentCode) || {};

  // NOTE: `missing()`/`textOr()` already return safe, ready-to-insert HTML
  // (an escaped value wrapped in a styled span) - never re-run escapeHtml()
  // on their output, only on a genuine plain-text value. Mixing the two
  // caused a real, reproducible bug: for any agent code absent from
  // agents.js (e.g. a synthetic/test PDF), the fallback HTML span was
  // escaped a second time at the template site below and showed up to the
  // client as literal `<span class="na">...</span>` markup instead of
  // styled text.
  const agencyPlain = agentConfig.agency || null;
  const agencyName = agencyPlain ? escapeHtml(agencyPlain) : textOr(null, 'agency not configured for this agent code', 'our agency');
  const branchName = agentConfig.branch ? escapeHtml(agentConfig.branch) : '';
  const preparedByName = agentConfig.name
    ? escapeHtml(agentConfig.name)
    : agent.agentNameOnDocument
      ? escapeHtml(agent.agentNameOnDocument)
      : missing('agent name not found', 'your servicing agent');
  const agentLine = [preparedByName, agent.agentCode ? `Agent ${escapeHtml(agent.agentCode)}` : null].filter(Boolean).join(' · ');
  const dealershipLine = [agentConfig.branch, agentConfig.agency, agentConfig.location].filter(Boolean).join(' · ');

  // Agent branding: use the agent's own logo from agents.js if one has
  // been filled in there, falling back to the generic gold-mark SVG
  // otherwise - never fabricated, exactly what agents.js already has (or
  // doesn't). agentConfig.logo is expected to be a URL or a data: URI;
  // agents.js's own header documents it as intentionally left '' until a
  // real asset exists.
  const logoHtml = agentConfig.logo
    ? `<img class="mark" src="${escapeHtml(agentConfig.logo)}" alt="${escapeHtml(agencyPlain || 'our agency')} logo">`
    : `<svg class="mark" viewBox="0 0 100 100" aria-label="${escapeHtml(agencyPlain || 'our agency')}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FDB913"/><stop offset="1" stop-color="#D4AF37"/></linearGradient></defs>
      <rect width="100" height="100" rx="14" fill="#000"/>
      <path d="M50 20 L70 66 L58 66 L50 44 L42 66 L30 66 Z" fill="url(#g)"/>
      <path d="M62 40 L80 80 L68 80 L58 56 Z" fill="url(#g)" opacity=".55"/>
    </svg>`;

  // --- Quotation No / Valid until: client mode only shows these if the
  // agent explicitly supplied them via `agentReview` - never the parser's
  // placeholder or its auto-generated date (see file header). ---
  const quotationDateFormatted = metadata.quotationDate ? formatDateLong(metadata.quotationDate.iso) : null;
  const headerLines = [];
  if (mode === 'agent') {
    headerLines.push(
      `<b>Quotation No</b> ${metadata.quotationNumber && metadata.quotationNumber.value ? escapeHtml(metadata.quotationNumber.value) : '<span class="gen">— assign quotation number —</span>'}`
    );
    headerLines.push(`<b>Date</b> ${quotationDateFormatted ? escapeHtml(quotationDateFormatted) : missing()}`);
    headerLines.push(
      `<b>Valid until</b> ${metadata.validUntil ? `<span class="gen">${escapeHtml(formatDateLong(metadata.validUntil.iso))}</span>` : missing()}`
    );
  } else {
    if (agentReview.quotationNumber) {
      headerLines.push(`<b>Quotation No</b> ${escapeHtml(agentReview.quotationNumber)}`);
    }
    if (quotationDateFormatted) {
      headerLines.push(`<b>Date</b> ${escapeHtml(quotationDateFormatted)}`);
    }
    if (agentReview.validUntilIso) {
      headerLines.push(`<b>Valid until</b> ${escapeHtml(formatDateLong(agentReview.validUntilIso))}`);
    }
  }

  const planSubtitle = [metadata.productName, [plan.medicalRiderName, plan.medicalPlanTier ? `(${plan.medicalPlanTier})` : null].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ');
  const sourceNote =
    mode === 'client' && quotationDateFormatted
      ? `<div class="src-note">Interactive quotation prepared from the PruBSN Product Illustration dated ${escapeHtml(quotationDateFormatted)}.</div>`
      : '';

  const roomBoardItem = (benefits.benefitItems || []).find((i) => i.label === 'Hospital Daily Room and Board');
  const roomBoardCompact = roomBoardItem ? compactRate(roomBoardItem.value) : null;
  const roomBoardTag = roomBoardItem ? extractDayTag(roomBoardItem.value) : null;
  // The medical-card mockup has a fixed aspect ratio and clips overflow,
  // so it needs the terser "Medic TotalCare 200" form rather than the
  // fuller "Medic TotalCare Plan 200" used in the prose title/subtitle.
  const cardPlanLabel = plan.medicalRiderName
    ? [plan.medicalRiderName, bareTierNumber(plan.medicalPlanTier)].filter(Boolean).join(' ')
    : null;
  const hospitalSurgicalItem = (benefits.benefitItems || []).find((i) => i.label === 'In Hospital and Related Services');
  const hospitalSurgicalCompact = hospitalSurgicalItem ? primaryValue(hospitalSurgicalItem.value) : null;

  const optionColumns = options.columns || [];

  return `
<div class="sheet">

  <div class="head">
    ${logoHtml}
    <div class="co">${agencyName}<small>${branchName}</small></div>
    <div class="rt">${headerLines.join('<br>')}</div>
  </div>

  <div class="hero">
    <div class="medcard">
      <div class="brandrow"><span class="g">${agencyName}</span><span class="type">Medical Card</span></div>
      <div class="chip"></div>
      <div class="name">${escapeHtml(client.fullName || 'CLIENT NAME')}</div>
      <div class="foot">
        <div><span class="lab">Plan</span><br><b>${cardPlanLabel ? escapeHtml(cardPlanLabel) : missing()}</b></div>
        <div><span class="lab">Room &amp; Board</span><br><b>${roomBoardCompact ? escapeHtml(roomBoardCompact) : missing()}</b></div>
        <div><span class="lab">Cover to</span><br><b>${plan.coverageToAge != null ? `Age ${plan.coverageToAge}` : missing()}</b></div>
      </div>
    </div>
  </div>

  <div class="titles">
    <h1>Medical Card Quotation</h1>
    <div class="plan">${escapeHtml(planSubtitle)}</div>
    ${sourceNote}
  </div>

  <div class="body">

    <div class="prep">
      <div class="item name"><div class="k">Prepared for</div><div class="v">${textOr(client.fullName)}</div></div>
      <div class="item"><div class="k">Age</div><div class="v">${client.ageNextBirthday != null ? `${client.ageNextBirthday} next birthday` : missing()}</div></div>
      <div class="item"><div class="k">Gender</div><div class="v">${textOr(client.gender)}</div></div>
      <div class="item"><div class="k">Smoker</div><div class="v">${textOr(client.smokerStatus)}</div></div>
      <div class="item"><div class="k">Occupation</div><div class="v">${textOr(client.occupationClass)}</div></div>
      <div class="item"><div class="k">Prepared by</div><div class="v">${preparedByName}</div></div>
    </div>

    <div class="figs">
      <div class="fig"><div class="lab">Monthly Contribution</div><div class="amt">${money(contributions.totalMonthlyContribution)}<small>/mo</small></div><div class="sub">${contributions.totalAnnualContribution != null ? `${money(contributions.totalAnnualContribution)} / year` : ''}</div></div>
      <div class="fig"><div class="lab">Annual Limit</div><div class="amt">${textOr(benefits.annualLimit)}</div><div class="sub">${textOr(benefits.lifetimeLimit)}</div></div>
      <div class="fig"><div class="lab">Room &amp; Board</div><div class="amt">${roomBoardCompact ? escapeHtml(roomBoardCompact) : missing()}</div><div class="sub">${roomBoardTag ? escapeHtml(roomBoardTag) : ''}</div></div>
      <div class="fig"><div class="lab">Co-payment</div><div class="amt">${textOr(plan.coPaymentOption)}</div><div class="sub">${coPaymentAmount(plan.coPaymentOption) ? `RM ${coPaymentAmount(plan.coPaymentOption)} per disability` : ''}</div></div>
      <div class="fig"><div class="lab">Hospital &amp; Surgical</div><div class="amt">${hospitalSurgicalCompact ? escapeHtml(hospitalSurgicalCompact) : missing()}</div><div class="sub">cashless at panel</div></div>
      <div class="fig"><div class="lab">Coverage Term</div><div class="amt">${plan.coverageToAge != null ? `to Age ${plan.coverageToAge}` : missing()}</div><div class="sub">${plan.basicPlanTerm != null ? `${plan.basicPlanTerm} years` : ''}</div></div>
    </div>

    <h2 class="sec">What your medical card covers</h2>
    <table class="ben">
${renderBenefitsTable(benefits.benefitItems, helpers)}
    </table>

    <h2 class="sec">Your monthly contribution</h2>
    <div class="contrib">
      <div class="row"><span class="l">${textOr(plan.basicPlanName)} — Sum Covered ${plan.basicSumCovered != null ? money(plan.basicSumCovered) : missing()}</span><span class="r">${money(contributions.isaContribution)}</span></div>
      <div class="row"><span class="l">${textOr(plan.medicalRiderName)} — ${textOr(plan.medicalPlanTier)}, ${textOr(plan.coPaymentOption)}</span><span class="r">${money(contributions.medicTotalCareContribution)}</span></div>
      <div class="row"><span class="l">Wakalah Certificate Charge</span><span class="r">${money(contributions.wakalahCertificateCharge)}</span></div>
      <div class="row total"><span class="l">Total monthly amount payable</span><span class="r">${money(contributions.totalMonthlyContribution)} ${contributions.totalAnnualContribution != null ? `<small>· ${money(contributions.totalAnnualContribution)}/yr</small>` : ''}</span></div>
    </div>

    <h2 class="sec">Other options to consider</h2>
    <div class="opts">${optionColumns.length ? optionColumns.map((c, i) => renderOptionCard(c, i, optionColumns, helpers)).join('') : `\n      <div class="opt">${missing('options table not found')}</div>`}
    </div>

    <h2 class="sec">What is not covered</h2>
    <ul class="excl">
${renderExclusions(benefits.medicalExclusions, helpers)}
    </ul>

    <div class="note">
      <b>Please note.</b> ${renderNote(projection, client)}
    </div>

    <div class="foot2">
      <div class="s">${agentLine}</div>
      ${dealershipLine ? escapeHtml(dealershipLine) : missing('dealership details not configured for this agent', '')}<br>
      Benefit(s) payable under eligible certificate are protected by PIDM up to limits.
    </div>

  </div>
</div>`;
}

function documentShell(title, bodyHtml) {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${SHARED_STYLE}</style>
${bodyHtml}
`;
}

/**
 * Internal-only view: the same document an agent needs to check before
 * sending anything, with every warning/error visible. Never send this
 * page's output to a client.
 */
function renderAgentReviewHtml(parseResult) {
  const { data, warnings, errors } = parseResult || {};
  const clientName = data && data.client && data.client.fullName;
  const card = renderQuotationCard(data, 'agent');
  const banner = renderReviewBanner(warnings, errors);
  return documentShell(`[INTERNAL] Agent Review — ${clientName || 'Quotation'}`, `${banner}\n${card}`);
}

/**
 * A deliberately plain, unbranded page - so if this is ever accidentally
 * opened or forwarded, it cannot be mistaken for a real quotation.
 */
function renderBlockedHtml(reasons) {
  const list = reasons.length
    ? `<ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '<p>Awaiting agent review.</p>';
  return `<!doctype html>
<meta charset="utf-8">
<title>Quotation Not Ready</title>
<style>body{font-family:sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#333}
h1{color:#B3261E;font-size:20px}li{margin-bottom:6px}</style>
<h1>This quotation is not ready to send</h1>
<p>It has not cleared agent review. Open the agent review version, resolve the items below, then re-generate the client copy.</p>
${list}
`;
}

/**
 * The client-safe document. See file header for the full gate and
 * redaction rules - summarized:
 *   - `parseResult.errors` must be empty (Required fields all present)
 *   - `agentReview.acknowledged` must be `true` (the agent has looked at
 *     the review page and is choosing to proceed)
 *   - `agentReview.quotationNumber` / `agentReview.validUntilIso` are
 *     optional; if omitted, those lines simply don't appear - they are
 *     never auto-filled from parser output for a client-facing document
 *
 * @param {{data: object, warnings: object[], errors: object[]}} parseResult
 * @param {{acknowledged?: boolean, quotationNumber?: string, validUntilIso?: string}} agentReview
 */
function renderClientQuotationHtml(parseResult, agentReview = {}) {
  const { data, errors } = parseResult || {};
  if (errors && errors.length) {
    return renderBlockedHtml(errors.map((e) => `${e.field}: ${e.message}`));
  }
  if (!agentReview.acknowledged) {
    return renderBlockedHtml([
      'Agent has not yet reviewed and acknowledged this quotation. Open the agent review version first.',
    ]);
  }
  const clientName = data && data.client && data.client.fullName;
  const card = renderQuotationCard(data, 'client', agentReview);
  return documentShell(`Medical Card Quotation — ${clientName || 'Client'}`, card);
}

module.exports = { renderAgentReviewHtml, renderClientQuotationHtml, renderBlockedHtml, SHARED_STYLE };
