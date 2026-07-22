/**
 * renderNarrativeQuotation.js
 *
 * Phase 2 replacement renderer. Produces the CLIENT-facing quotation
 * document, built to match the visual design of the official reference
 * template ("PruBSN AnugerahMax Quotation - Standalone 2.html", supplied
 * directly by the user - not committed to this repo, a 6.2MB self-extracting
 * React export) as closely as a hand-written, data-driven renderer can.
 *
 * Consumes ONLY the `data` object from parser/parseQuotation.js (plus
 * getAgentConfig() for agent contact details, same as renderQuotation.js -
 * agent branding is config, not PDF data). No PDF parsing logic here.
 *
 * --- What was deliberately NOT carried over from the reference template ---
 *
 * The reference template lets a viewer live-toggle between an "Essential"
 * and a "Platinum" tier, showing exact contribution/benefit numbers for
 * BOTH tiers side by side. Our parser only ever extracts data for whichever
 * ONE tier the client's actual PDF quotes - it has no way to know what the
 * other tier would have cost this same client, because that figure simply
 * isn't in their Product Illustration. Inventing it would break the
 * project's "never invent data" rule. Per explicit user decision (asked
 * directly, see conversation), this renderer is single-plan-only: it shows
 * the client's actual quoted plan, with no plan-switch toggle and no
 * Essential-vs-Platinum comparison table.
 *
 * Every other hardcoded figure in the reference template that COULD vary
 * by plan tier (room & board rate, critical-illness boost amount, annual
 * limit, waiting periods, cash value scenarios, etc.) is bound here to the
 * real parser output - see buildViewModel() below - rather than assumed
 * from the one reference client's (Essential-tier) numbers. Where a
 * reference-template section depended on data the parser doesn't extract
 * for every plan (e.g. a specific critical-illness doubling clause), the
 * section is generated FROM whatever benefit items are actually present
 * for this client's plan, and is silently omitted if the underlying
 * benefit item isn't there - never replaced with an invented default.
 *
 * The five full-bleed "Ken Burns" photo sections (hospital lobby, ward,
 * operating theatre, twin-sharing room, cancer centre) use a placeholder
 * visual until the agency supplies real licensed photography - see
 * KEN_BURNS_SLOTS and kenBurnsMedia() below. Swapping in a real photo
 * later is a one-line change (set `assetUrl` in KEN_BURNS_SLOTS), no
 * markup restructuring required.
 *
 * Background music and the live plan-switch/"Switch" button from the
 * reference template are dropped entirely: the switch requires the
 * both-tiers data described above, and background music requires an audio
 * asset nobody has supplied. Scroll-triggered narration (browser
 * SpeechSynthesis reading each Ken Burns section aloud) IS kept - it needs
 * no external asset.
 */

'use strict';

/**
 * Bumped whenever this file's markup/behaviour changes in a way that
 * matters for a previously-*published* quotation (see backend/src/publish.js
 * and its D1 schema) - stored alongside each published quotation's
 * already-rendered HTML so it's always possible to tell which renderer
 * produced a given stored document, even though the stored HTML itself
 * is never re-rendered after publishing.
 */
const RENDERER_VERSION = 'narrative-v1';

const { getAgentConfig } = require('../parser/agents');
const {
  escapeHtml,
  formatMoney,
  formatMoneyFixed2,
  resolveMonthlyTotalPayable,
} = require('./formatters');
const AssetManager = require('./AssetManager');

// ---------------------------------------------------------------------------
// Small client-safe presentation helpers (this file's own - the "missing"
// helper in renderQuotation.js is agent/client dual-mode; this renderer is
// client-mode only, so a simpler single-purpose version lives here).
// ---------------------------------------------------------------------------

function naSpan(text) {
  return `<span class="pq-na">${escapeHtml(text || 'Refer to certificate')}</span>`;
}

function textOr(value, clientText) {
  return value ? escapeHtml(value) : naSpan(clientText);
}

function moneyRM(n) {
  const formatted = formatMoney(n);
  return formatted == null ? null : `RM ${formatted}`;
}

/** Matches the no-space "RM200" style already used throughout this file (mirrors the source PDF's own printed format) - moneyRM()'s "RM 200" (with a space) is a different, already-established convention used only for narrative prose mentions. */
function moneyRMNoSpace(n) {
  const formatted = formatMoney(n);
  return formatted == null ? null : `RM${formatted}`;
}

/** "(maximum N days per year)" - the parenthetical note style already used throughout this file for room & board day limits. */
function maxDaysNote(days) {
  return days != null ? `(maximum ${days} days per year)` : null;
}

/** First given name only, for the narrative's direct-address lines - falls back to the full name if it can't be split. */
function firstName(fullName) {
  if (!fullName) return null;
  const parts = String(fullName).trim().split(/\s+/);
  return parts[0] || fullName;
}

/** Finds one benefit item by its exact extractor label - see docs/PARSER_API.md's data.benefits.benefitItems. */
function findBenefit(benefitItems, label) {
  return (benefitItems || []).find((b) => b.label === label) || null;
}

/** Pulls the first "RM x,xxx" style figure out of a benefit value string. */
function extractRmAmount(value) {
  if (!value) return null;
  const m = String(value).match(/RM\s*([\d,]+(?:\.\d+)?)/);
  return m ? m[0].replace(/\s+/g, ' ') : null;
}

/** Pulls a "(maximum N days ...)" style parenthetical out of a benefit value string. */
function extractDayNote(value) {
  if (!value) return null;
  const m = String(value).match(/\(([^)]*\bdays?\b[^)]*)\)/i);
  return m ? m[1] : null;
}

// A small, closed vocabulary of critical-illness conditions that actually
// appear (verbatim, capitalised) in the "Additional Annual Limit for" /
// similar benefit rows across PruBSN AnugerahMax Product Illustrations.
// Checking substring presence against this list - rather than trying to
// fully parse the messy joined-cell grammar those rows come out as - only
// ever reports a condition that is genuinely printed in the extracted
// text, never one inferred or assumed.
const KNOWN_CRITICAL_ILLNESS_TERMS = ['Cancer', 'Heart Attack', 'Kidney Failure', 'Stroke'];

/**
 * Builds the "your limit gets boosted" narrative clause from whatever the
 * parser actually extracted for this plan's critical-illness benefit rows -
 * returns null (never a fabricated default) if the plan has no such
 * benefit item, or if it has one but no RM figure could be found in it.
 */
function criticalIllnessBoost(benefitItems) {
  const item = findBenefit(benefitItems, 'Additional Annual Limit for');
  if (!item || !item.value) return null;
  const amount = extractRmAmount(item.value);
  if (!amount) return null;
  const conditions = KNOWN_CRITICAL_ILLNESS_TERMS.filter((term) =>
    new RegExp(term, 'i').test(item.value)
  );
  return { amount, conditions };
}

/**
 * A short table of facts that are true of the BASIC PruBSN AnugerahMax
 * plan itself (not the medical rider, not client-specific numbers) -
 * verified against the reference template and the sample PDF's own "C.
 * Guaranteed Protection" wording. Keyed by the exact metadata.productName
 * string, same pattern as validate.js's KNOWN_PLAN_TIER_ANNUAL_LIMITS: an
 * unrecognised product name means these bullets are simply omitted, never
 * shown with a guessed value.
 */
const PRODUCT_FACTS = {
  'PruBSN AnugerahMax': {
    extensionToAge100: true,
    pidmProtected: true,
  },
  // Verified directly from the real Asas360 sample: p.1's cover page
  // carries the same PIDM/TIPS protection notice AnugerahMax's does, and
  // p.30's "Appendix: Other Certificate Benefits and Options" describes
  // the same Extension of Certificate Term feature (coverage continues to
  // age 100 next birthday, cash value permitting) - not assumed from
  // AnugerahMax, independently confirmed in Asas360's own document.
  'PruBSN Asas360': {
    extensionToAge100: true,
    pidmProtected: true,
  },
};

// ---------------------------------------------------------------------------
// Full-bleed "Ken Burns" photo sections - image selection goes entirely
// through AssetManager (renderer/AssetManager.js), never a hardcoded
// filename here. AssetManager always resolves to *some* URL (falling
// back to a site-wide default), but that file may not actually exist on
// disk yet (no production photography has been supplied at the time
// this was written) - imageWithFallback() renders BOTH a real <img> AND
// a hidden placeholder panel behind it, and the runtime script
// (NARRATIVE_RUNTIME below) reveals the placeholder if the <img> ever
// fails to load. This is the "do not crash, never a broken image icon"
// contract, split across two layers by design - see AssetManager.js's
// own header comment for why.
// ---------------------------------------------------------------------------

/**
 * @param {string} url from AssetManager - always a resolved path, never null
 * @param {string} altText
 * @param {string} [layoutClass] 'pq-kenburns' for a full-bleed Ken Burns
 *   section (the default - matches every existing call site), or
 *   'pq-inline-photo' for a compact, non-full-bleed rounded image used
 *   inline within an otherwise card-based section (plan/guarantee/
 *   waiting-period/cash-value placements).
 */
function imageWithFallback(url, altText, layoutClass = 'pq-kenburns') {
  return `<img class="pq-reveal pq-photo ${layoutClass}" src="${escapeHtml(url)}" alt="${escapeHtml(altText)}">
      <div class="pq-kb-placeholder ${layoutClass === 'pq-inline-photo' ? 'pq-inline-photo' : ''}" style="display:none" role="img" aria-label="${escapeHtml(altText)}">
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#9FB4D1" stroke-width="1.3"><rect x="3" y="8" width="18" height="13" rx="1.2"></rect><path d="M3 8l9-5 9 5"></path><path d="M12 11v6M9 14h6"></path></svg>
      </div>`;
}

// ---------------------------------------------------------------------------
// View-model: every value the sections below need, computed once from the
// parser's `data` object (plus agent config). Sections read from this, not
// from `data` directly, so any given piece of derived logic lives in one
// place.
// ---------------------------------------------------------------------------

function buildViewModel(data, agentReview) {
  const { metadata = {}, client = {}, agent = {}, plan = {}, contributions = {}, medical = {}, protection = {}, projection = {} } = data || {};
  const agentConfig = getAgentConfig(agent.agentCode) || {};
  // Every medical fact (rider name, tier, co-payment, coverage term, room &
  // board, benefit items, waiting periods, coverage model) is read from the
  // product-agnostic data.medical, not data.plan/data.benefits directly -
  // this renderer must not need to know which product generated the data
  // (see the Medical Card Engine plan). For AnugerahMax, data.medical is an
  // additive mirror of data.plan/data.benefits (identical values), so this
  // is a no-op switch for that product; for Asas360, data.plan/data.benefits
  // simply don't exist in the same shape, so this is what makes the medical
  // sections populate at all.
  const benefitItems = medical.benefitItems || [];

  // resolveMonthlyTotalPayable() only reads AnugerahMax's own
  // `contributions` shape; Asas360's directly-printed "Monthly Total
  // Amount Payable" / "Total Annual Contribution" live at the top level of
  // `data` instead (see extractors/asas360.js) - falling back to those,
  // real printed figures, never derived/estimated for either product.
  const monthlyValue =
    resolveMonthlyTotalPayable(contributions) ??
    (data && data.monthlyTotalAmountPayable != null
      ? data.monthlyTotalAmountPayable
      : data && data.totalAnnualContribution != null
      ? Math.round((data.totalAnnualContribution / 12) * 100) / 100
      : null);
  const monthlyFormatted = monthlyValue != null ? `RM ${formatMoneyFixed2(monthlyValue)}` : null;
  const monthlyCompact = monthlyValue != null ? moneyRM(monthlyValue) : null; // for narrative prose mentions only - never the formal labelled figure

  // Sourced from medical.roomAndBoard's already-normalized {amount,
  // maxDaysPerYear} rather than re-deriving from a benefit item by its
  // exact label text - Asas360's real label ("Hospital Daily Room & Board")
  // differs from AnugerahMax's ("Hospital Daily Room and Board"), and the
  // renderer must not hardcode either product's specific wording.
  const roomAndBoard = medical.roomAndBoard || {};
  const roomBoardAmount = moneyRMNoSpace(roomAndBoard.amount);
  const roomBoardDayNote = maxDaysNote(roomAndBoard.maxDaysPerYear);

  const boost = criticalIllnessBoost(benefitItems);

  const purposeRaw = client.takafulPlanPurpose;
  const purpose = purposeRaw
    ? /non-business/i.test(purposeRaw) ? 'Personal' : /business/i.test(purposeRaw) ? 'Business' : purposeRaw
    : null;

  const productFacts = PRODUCT_FACTS[metadata.productName] || {};

  const currentRow = (projection.projectionRows || []).find((r) => r.age === client.ageNextBirthday) || null;

  // Certificate term in years - sourced from the product-agnostic
  // data.protection.basicPlanTerm (see normalize/toProtectionJson.js),
  // populated for both products now. Falls back to the derived
  // coverageToAge-minus-current-age calculation only if that's somehow
  // absent - verified against the real Asas360 sample's own printed
  // "Certificate Term: 59 years" line (60 - 1 = 59, matches exactly).
  const coverageTermYears =
    protection.basicPlanTerm != null
      ? protection.basicPlanTerm
      : medical.coverageToAge != null && client.ageNextBirthday != null
      ? medical.coverageToAge - client.ageNextBirthday
      : null;

  return {
    clientName: client.fullName || null,
    clientFirstName: firstName(client.fullName),
    ageNextBirthday: client.ageNextBirthday,
    gender: client.gender,
    smokerStatus: client.smokerStatus,
    occupationClass: client.occupationClass,
    purpose,
    paymentMode: plan.paymentMode,

    productName: metadata.productName,
    medicalRiderName: medical.riderName,
    medicalPlanTier: medical.planTier,
    planName: medical.planName,
    coPaymentOption: medical.coPayment,
    basicPlanTerm: coverageTermYears,
    coverageToAge: medical.coverageToAge,
    coverageStartAge: client.ageNextBirthday != null ? client.ageNextBirthday + 1 : null,

    agentName: agentConfig.name || agent.agentNameOnDocument || null,
    agentCode: agent.agentCode || null,
    agencyName: agentConfig.agency || null,
    agencyLogo: agentConfig.logo || null,

    monthlyFormatted,
    monthlyCompact,
    totalAnnualContribution: contributions.totalAnnualContribution != null ? contributions.totalAnnualContribution : (data && data.totalAnnualContribution),
    totalContributionOverTerm: contributions.totalContributionOverTerm,
    // Sourced from data.protection (see normalize/toProtectionJson.js),
    // populated for both products - Asas360's is formula-based (Basic Sum
    // Covered plus/before the cash value of the certificate), never a
    // fabricated single combined number, so the description is carried
    // alongside the guaranteed floor amount rather than replacing it.
    guaranteedDeathTPDBenefit: protection.deathBenefit ? protection.deathBenefit.amount : null,
    deathBenefitDescription: protection.deathBenefit ? protection.deathBenefit.description : null,
    isaContribution: contributions.isaContribution,
    protectionContribution: contributions.protectionContribution,
    wakalahCertificateCharge: contributions.wakalahCertificateCharge,
    // Only ever populated when the product prints a single flat cash
    // value figure (AnugerahMax) - Asas360's investment-linked structure
    // only ever prints a year-by-year schedule (protection.cashValue.schedule),
    // never a single "the" cash value, so these stay null for that product
    // rather than picking one arbitrary year and presenting it as definitive.
    cashValueX: protection.cashValue ? protection.cashValue.scenarioX : null,
    cashValueY: protection.cashValue ? protection.cashValue.scenarioY : null,

    coverageModel: medical.coverageModel,
    coverageExplanation: medical.coverageExplanation,
    annualLimit: medical.annualLimit,
    lifetimeLimit: medical.lifetimeLimit,
    lifetimeFundAmount: medical.lifetimeFundAmount,
    costSharingAfterExhaustion: medical.costSharingAfterExhaustion,
    // A single, coverage-model-agnostic headline figure for sections that
    // just need "the number that describes how much cover you have" -
    // never both at once, since exactly one is non-null per coverage model.
    coverageHeadline: medical.annualLimit || medical.lifetimeLimit || null,
    benefitItems,
    waitingPeriods: (medical.waitingPeriods || []).slice().sort((a, b) => a.days - b.days),

    roomBoardAmount,
    roomBoardDayNote,
    boost,
    productFacts,

    projectedAgeContribution: currentRow ? moneyRM(currentRow.currentContribution) : null,

    quotationNumber: agentReview && agentReview.quotationNumber ? agentReview.quotationNumber : null,
  };
}

// ---------------------------------------------------------------------------
// CSS - namespaced under `pq-` (Prubsn Quotation) to avoid any collision
// with the `.paf-*` application-flow styles composeClientDocument.js
// appends after this renderer's output. The `--teal`/`--ink`/etc. custom
// properties are the SAME variable names the application-flow CSS already
// references (see composeClientDocument.js's APPLICATION_STYLE) - mapped
// here to the new template's real palette instead of the old medical-card
// design's, so the "Continue Application" flow inherits the new branding
// automatically with no changes needed on its side.
// ---------------------------------------------------------------------------

const NARRATIVE_STYLE = `
  :root{
    --teal:#178D93; --teal-dk:#0F6E73;
    --ink:#0B2545; --meta:#5A6B85; --line:rgba(11,37,69,0.12); --card:#ffffff;
    --rose-soft:#F6F1EE; --gold-a:#C9962E; --gold-b:#E0B25A;
    --serif:"Newsreader",Georgia,"Times New Roman",serif;
    --sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,sans-serif;
  }
  #pq-doc{font-family:var(--sans);color:var(--ink);width:100%;overflow-x:hidden}
  #pq-doc *{box-sizing:border-box}
  #pq-doc a{color:var(--teal)}
  #pq-doc a:hover{color:var(--teal-dk)}
  body:has(#pq-doc){margin:0;background:linear-gradient(165deg,#F6C9D6 0%,#F2D3E2 18%,#E7D7EC 38%,#D6E1F0 60%,#C3E7F3 82%,#BEEAF4 100%);background-attachment:fixed}

  .pq-reveal{opacity:1;transform:none}
  .pq-zoom{opacity:0.12;transform:scale(0.72)}
  @media (prefers-reduced-motion:no-preference){
    .pq-reveal{opacity:0;transform:translateY(26px);transition:opacity .8s cubic-bezier(.22,1,.36,1),transform .8s cubic-bezier(.22,1,.36,1)}
    .pq-reveal[data-visible]{opacity:1;transform:translateY(0)}
    .pq-reveal.d1[data-visible]{transition-delay:.08s}
    .pq-reveal.d2[data-visible]{transition-delay:.16s}
    .pq-reveal.d3[data-visible]{transition-delay:.24s}
    .pq-reveal.d4[data-visible]{transition-delay:.32s}
    .pq-donut-seg{transition:stroke-dashoffset 1.3s cubic-bezier(.22,1,.36,1) .25s}
    .pq-draw-path{transition:stroke-dashoffset 1.5s cubic-bezier(.22,1,.36,1) .2s}
    .pq-zoom{opacity:0;transform:scale(0.72)}
    .pq-kenburns{transform:scale(1.15);transition:transform 9s cubic-bezier(.22,1,.36,1)}
    .pq-kenburns[data-visible]{transform:scale(1)}
  }
  @keyframes pqIntro{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
  @keyframes pqPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(23,141,147,.35)}50%{transform:scale(1.05);box-shadow:0 0 0 18px rgba(23,141,147,0)}}

  #pq-doc section{padding:56px 28px}
  #pq-doc .pq-eyebrow{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--teal)}
  #pq-doc .pq-headline{font-family:var(--serif);font-weight:600;line-height:1.28;margin-top:12px}
  #pq-doc .pq-lede{font-size:16px;color:var(--meta);margin-top:12px;line-height:1.6}
  #pq-doc .pq-na{color:var(--meta);font-style:italic}

  .pq-hero{min-height:92vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding-top:calc(env(safe-area-inset-top) + 40px)}
  .pq-brandmark{font-family:var(--serif);font-weight:700;font-size:19px;color:var(--ink)}
  .pq-award{display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,.55);border:1px solid var(--line);border-radius:100px;padding:10px 18px;font-size:13px;font-weight:700;color:#6b5a2e;margin-top:20px}
  .pq-tagline{font-family:var(--serif);font-style:italic;font-size:44px;font-weight:600;color:var(--teal);margin-top:34px}
  .pq-tagline-en{font-size:16px;color:var(--meta);margin-top:6px}
  .pq-hero-title{font-family:var(--serif);font-size:30px;font-weight:600;margin-top:40px;max-width:480px;line-height:1.35}
  .pq-hero-sub{margin-top:28px;font-size:15px;color:var(--meta)}
  .pq-scroll-cue{margin-top:40px;font-size:13px;color:#5a6b85;letter-spacing:.1em;text-transform:uppercase;text-align:center}

  .pq-stat-pill{display:inline-flex;align-items:center;gap:14px;margin-top:36px;color:#fff;border-radius:100px;padding:14px 22px;box-shadow:0 10px 28px rgba(23,141,147,.25);background:var(--teal)}
  .pq-stat-pill b{font-size:26px;font-weight:800;font-family:var(--serif);line-height:1}
  .pq-stat-pill span{font-size:13px;font-weight:600;line-height:1.3}

  .pq-path-grid{display:flex;flex-direction:column;gap:28px;margin-top:20px}
  .pq-path-card{background:#fff;border-radius:14px;padding:28px 22px;box-shadow:0 6px 20px rgba(11,37,69,.08);text-align:center}
  .pq-path-card.pq-dark{background:var(--ink);color:#fff}
  .pq-path-card .pq-path-label{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--meta)}
  .pq-path-card.pq-dark .pq-path-label{color:#9FB4D1}
  .pq-path-card .pq-path-title{font-size:17px;font-weight:700;margin-top:6px}
  .pq-path-card .pq-path-desc{font-size:13px;color:var(--meta);margin-top:12px}
  .pq-path-card.pq-dark .pq-path-desc{color:#C7D3E3}

  .pq-drama{position:relative;min-height:56vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:linear-gradient(160deg,#0B2545 0%,#16345E 100%);color:#fff;overflow:hidden}
  .pq-drama .pq-headline{position:relative;color:#fff;font-size:32px;max-width:440px}
  .pq-drama .pq-eyebrow{position:relative;color:#CFE0EE}
  .pq-drama .pq-figure{color:#F2A65A}

  .pq-consequence-steps{display:flex;flex-direction:column;gap:14px;margin-top:26px}
  .pq-consequence-step{background:#fff;border-radius:10px;padding:20px;box-shadow:0 6px 20px rgba(11,37,69,.08);border-left:4px solid var(--gold-a)}
  .pq-consequence-step .pq-step-title{font-size:16px;font-weight:700}
  .pq-consequence-step .pq-step-desc{font-size:14px;color:var(--meta);margin-top:4px;line-height:1.5}
  .pq-consequence-step.pq-warn{background:#B5493D;color:#fff;border-left-color:transparent}
  .pq-consequence-step.pq-warn .pq-step-desc{color:#FDE2DE}

  .pq-protected-card{background:var(--teal);color:#fff;border-radius:14px;padding:30px 24px;margin-top:24px;text-align:center;box-shadow:0 10px 30px rgba(23,141,147,.25)}
  .pq-protected-card .pq-protected-figure{font-size:22px;font-weight:700;font-family:var(--serif);margin-top:18px}
  .pq-protected-card .pq-protected-note{font-size:14px;color:#E3ECF5;margin-top:10px;line-height:1.5}

  .pq-summary-card{padding-top:64px;border-top:1px solid var(--line)}
  .pq-summary-name{font-family:var(--serif);font-size:40px;line-height:1.1;font-weight:600;margin-top:10px}
  .pq-summary-rows{margin-top:36px;border-top:1px solid var(--line)}
  .pq-summary-row{display:flex;justify-content:space-between;padding:18px 0;border-bottom:1px solid var(--line)}
  .pq-summary-row .l{font-size:15px;color:var(--meta)}
  .pq-summary-row .r{font-size:18px;font-weight:600}

  .pq-stat-grid{display:flex;flex-direction:column;gap:16px;margin-top:32px}
  .pq-stat-card{background:#fff;border-radius:10px;padding:22px 24px;display:flex;align-items:center;gap:18px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-stat-card .pq-stat-figure{font-size:32px;font-weight:800;font-family:var(--serif);color:var(--teal);line-height:1}
  .pq-stat-card .pq-stat-label{font-size:14px;margin-top:6px;line-height:1.4}
  .pq-source-note{font-size:12px;color:#7C88A0;margin-top:8px;line-height:1.5}

  .pq-cost-list{display:flex;flex-direction:column;gap:20px;margin-top:32px}
  .pq-cost-row .pq-cost-head{display:flex;justify-content:space-between;font-size:15px;margin-bottom:6px}
  .pq-cost-track{height:12px;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 0 0 1px rgba(11,37,69,.08) inset}
  .pq-cost-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--teal),#0B5B60)}
  .pq-cost-fill.pq-gold{background:var(--gold-a)}

  .pq-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:28px}
  .pq-profile-item{background:#fff;border-radius:8px;padding:20px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-profile-item.pq-wide{grid-column:1/-1}
  .pq-profile-item .k{font-size:13px;color:#7C88A0;text-transform:uppercase;letter-spacing:.05em}
  .pq-profile-item .v{font-size:19px;font-weight:600;margin-top:6px}

  .pq-donut-wrap{position:relative;width:220px;height:220px;margin:36px auto 0}
  .pq-donut-total{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .pq-donut-total .k{font-size:13px;color:#7C88A0;text-transform:uppercase;letter-spacing:.05em}
  .pq-donut-total .v{font-size:34px;font-weight:800;font-family:var(--serif);color:var(--ink)}
  .pq-contrib-list{display:flex;flex-direction:column;gap:16px;margin-top:32px}
  .pq-contrib-item{display:flex;gap:16px;align-items:flex-start;background:#fff;border-radius:8px;padding:20px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-contrib-dot{width:14px;height:14px;border-radius:4px;margin-top:5px;flex-shrink:0}
  .pq-contrib-item .k{font-size:18px;font-weight:700}
  .pq-contrib-item .d{font-size:15px;color:var(--meta);margin-top:6px;line-height:1.5}

  .pq-kb-section{position:relative;min-height:88vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px 28px;overflow:hidden}
  .pq-kb-media{position:absolute;inset:0;overflow:hidden}
  .pq-kb-media img.pq-kenburns{width:100%;height:100%;object-fit:cover}
  .pq-kb-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#16345E 0%,#0B2545 100%)}

  /* Compact, non-full-bleed image used inline within an otherwise
     card-based section (plan/guarantee/waiting-period/cash-value) -
     same graceful onerror-fallback mechanism as the full-bleed Ken Burns
     photos, just a smaller rounded rectangle rather than a whole section
     background. */
  .pq-inline-photo-wrap{margin-top:20px;border-radius:12px;overflow:hidden;height:160px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  img.pq-inline-photo{width:100%;height:160px;object-fit:cover;border-radius:12px;display:block}
  .pq-kb-placeholder.pq-inline-photo{height:160px;border-radius:12px}
  .pq-kb-overlay{position:absolute;inset:0;background:linear-gradient(rgba(11,37,69,.5) 0%,rgba(11,37,69,.68) 55%,rgba(11,37,69,.86) 100%)}
  .pq-kb-content{position:relative;color:#fff;max-width:460px}
  .pq-kb-content .pq-eyebrow{color:#CFE0EE}
  .pq-kb-content .pq-headline{color:#fff;font-size:30px}
  .pq-kb-figure{font-size:52px;font-weight:800;font-family:var(--serif);color:#4FD1D9;margin-top:16px}
  .pq-kb-figure small{font-size:20px;color:#CFE0EE;font-weight:600}
  .pq-kb-note{font-size:14px;color:#E3ECF5;margin-top:16px;line-height:1.5}

  .pq-benefit-list{display:flex;flex-direction:column;gap:14px;margin-top:20px}
  .pq-benefit-card{background:#fff;border-radius:8px;padding:20px;display:flex;gap:16px;align-items:flex-start;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-benefit-card .k{font-size:16px;font-weight:700}
  .pq-benefit-card .d{font-size:14px;color:var(--meta);margin-top:4px;line-height:1.5}
  .pq-benefit-dot{width:22px;height:22px;flex-shrink:0;color:var(--teal)}

  .pq-guarantee-hero{background:var(--ink);color:#fff;border-radius:12px;padding:32px 26px;margin-top:32px;box-shadow:0 10px 30px rgba(11,37,69,.2)}
  .pq-guarantee-hero .pq-eyebrow{color:#9FB4D1}
  .pq-guarantee-hero .pq-figure{font-size:52px;font-weight:800;font-family:var(--serif);margin-top:8px}
  .pq-guarantee-hero .pq-note{font-size:16px;margin-top:12px;line-height:1.55;color:#C7D3E3}
  .pq-fact-list{display:flex;flex-direction:column;gap:16px;margin-top:20px}
  .pq-fact-card{background:#fff;border-radius:10px;padding:24px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-fact-card .k{font-size:17px;font-weight:600;color:var(--teal)}
  .pq-fact-card .d{font-size:15px;margin-top:8px;color:var(--meta);line-height:1.5}

  .pq-wait-list{display:flex;flex-direction:column;gap:14px;margin-top:28px}
  .pq-wait-card{background:#fff;border-radius:10px;padding:22px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-wait-card.pq-first{background:var(--teal);color:#fff}
  .pq-wait-card .k{font-size:16px;font-weight:700}
  .pq-wait-card .d{font-size:14px;color:var(--meta);margin-top:4px;line-height:1.5}
  .pq-wait-card.pq-first .d{color:#E3ECF5}

  .pq-cashvalue-legend{display:flex;flex-direction:column;gap:10px;margin-top:24px}
  .pq-cv-row{display:flex;align-items:center;gap:10px;background:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-cv-dot{width:10px;height:10px;border-radius:50%}

  .pq-summary4{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:28px}
  .pq-summary4-card{background:#fff;border-radius:10px;padding:22px 18px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-summary4-card.pq-accent{background:var(--teal);color:#fff}
  .pq-summary4-card .k{font-size:13px;color:#7C88A0;text-transform:uppercase;letter-spacing:.05em}
  .pq-summary4-card.pq-accent .k{color:#FFD0D8}
  .pq-summary4-card .v{font-size:26px;font-weight:800;font-family:var(--serif);margin-top:8px}
  .pq-summary4-card .s{font-size:12px;color:#7C88A0;margin-top:6px}
  .pq-summary4-card.pq-accent .s{color:#FFD0D8}

  .pq-steps{display:flex;flex-direction:column;gap:14px;margin-top:32px}
  .pq-step-card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-step-card .k{font-size:13px;color:#7C88A0;text-transform:uppercase;letter-spacing:.05em}
  .pq-step-card .v{font-size:17px;font-weight:600;margin-top:6px}

  .pq-agent-footer{margin-top:40px;border-top:1px solid var(--line);padding-top:26px;display:flex;gap:16px;align-items:flex-start}
  .pq-agent-footer img{width:56px;height:56px;border-radius:10px;object-fit:cover;flex-shrink:0}
  .pq-agent-footer .name{font-size:19px;font-weight:700}
  .pq-agent-footer .meta{font-size:15px;color:var(--meta);margin-top:4px}
  .pq-agent-footer .fine{font-size:13px;color:#7C88A0;margin-top:18px;line-height:1.5}

  .pq-contact-fields{display:flex;flex-direction:column;gap:14px;margin-top:32px}
  .pq-contact-field{background:#fff;border-radius:10px;padding:6px 18px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-contact-field input{width:100%;border:none;outline:none;background:transparent;font-family:var(--sans);font-size:16px;color:var(--ink);padding:14px 0}
  .pq-cta{width:100%;margin-top:20px;background:var(--teal);color:#fff;border:none;border-radius:100px;padding:18px 24px;font-family:var(--sans);font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 10px 28px rgba(23,141,147,.3)}
  .pq-cta:hover{filter:brightness(1.05)}
  .pq-contact-note{margin-top:18px;font-size:13px;color:#7C88A0;line-height:1.5;text-align:center}

  .pq-outro{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-top:1px solid var(--line)}
  .pq-outro-badge{width:84px;height:84px;border-radius:50%;background:var(--teal);display:flex;align-items:center;justify-content:center;animation:pqPulse 2.4s ease-in-out infinite}
  .pq-outro-tagline{font-family:var(--serif);font-style:italic;font-size:30px;font-weight:600;color:var(--teal);margin-top:26px}
  .pq-outro-sub{font-size:15px;color:var(--meta);margin-top:8px}

  @media print{
    /* Fixed-position overlays/controls make no sense on paper - same
       lesson as the old renderer's print CSS (see renderQuotation.js's
       SHARED_STYLE comment). Found the same way: printing a fresh preview
       that had never been clicked past the "tap anywhere to continue"
       intro would otherwise bury the whole printed page under it. */
    .pq-intro-overlay, .pq-sound-btn{display:none!important}
    #pq-doc .pq-reveal, #pq-doc .pq-zoom{opacity:1!important;transform:none!important}
    #pq-doc .pq-kb-section{min-height:0!important;page-break-inside:avoid}
    #pq-doc *{animation:none!important;transition:none!important}
    #pq-doc, #pq-doc *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
`;

// ---------------------------------------------------------------------------
// Vanilla-JS runtime: scroll reveal / zoom / kenburns trigger, plus a
// narration toggle. No React, no build step - a small self-contained
// IIFE, matching the reference template's own reveal-on-scroll behaviour
// (rAF loop computing element position each frame) without depending on
// its proprietary component framework.
// ---------------------------------------------------------------------------

const NARRATIVE_RUNTIME = `
(function () {
  var root = document.getElementById('pq-doc');
  if (!root) return;

  var intro = root.querySelector('.pq-intro-overlay');
  if (intro) {
    intro.addEventListener('click', function () {
      intro.style.opacity = '0';
      intro.style.visibility = 'hidden';
    });
  }

  // AssetManager (renderer/AssetManager.js) always resolves to *some*
  // URL, even if that file doesn't actually exist on disk yet (no
  // production photography supplied at render time). This is the other
  // half of that contract: never show a broken-image icon - swap to the
  // sibling placeholder panel instead, exactly once per image.
  root.querySelectorAll('img.pq-photo').forEach(function (img) {
    img.addEventListener('error', function () {
      img.style.display = 'none';
      var placeholder = img.nextElementSibling;
      if (placeholder && placeholder.classList.contains('pq-kb-placeholder')) {
        placeholder.style.display = 'flex';
      }
    }, { once: true });
  });

  var soundBtn = root.querySelector('.pq-sound-btn');
  var audioOn = false;
  function setSoundLabel() {
    if (!soundBtn) return;
    var label = soundBtn.querySelector('.pq-sound-label');
    if (label) label.textContent = audioOn ? 'Sound on' : 'Tap for sound';
  }
  if (soundBtn) {
    soundBtn.addEventListener('click', function () {
      audioOn = !audioOn;
      setSoundLabel();
      if (!audioOn && window.speechSynthesis) window.speechSynthesis.cancel();
    });
  }

  var narrateEls = Array.prototype.slice.call(root.querySelectorAll('[data-narrate]'));
  if (narrateEls.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (!audioOn) return;
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.55 && !entry.target.hasAttribute('data-narrated')) {
          entry.target.setAttribute('data-narrated', '');
          var text = entry.target.getAttribute('data-narrate');
          if (text && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            var utter = new SpeechSynthesisUtterance(text);
            utter.rate = 0.98;
            window.speechSynthesis.speak(utter);
          }
        }
      });
    }, { threshold: [0, 0.55, 1] });
    narrateEls.forEach(function (el) { io.observe(el); });
  }

  var revealEls = Array.prototype.slice.call(root.querySelectorAll('.pq-reveal, [data-final-width], [data-final-offset]'));
  var zoomEls = Array.prototype.slice.call(root.querySelectorAll('.pq-zoom'));

  function applyFinal(el) {
    if (el.hasAttribute('data-final-width')) el.style.width = el.getAttribute('data-final-width');
    if (el.hasAttribute('data-final-offset')) el.style.strokeDashoffset = el.getAttribute('data-final-offset');
  }

  function step() {
    var vh = window.innerHeight || 800;
    for (var i = 0; i < revealEls.length; i++) {
      var el = revealEls[i];
      if (el.hasAttribute('data-visible')) continue;
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.92) {
        el.setAttribute('data-visible', '');
        applyFinal(el);
      }
    }
    var zStart = vh * 0.88, zEnd = vh * 0.4;
    for (var j = 0; j < zoomEls.length; j++) {
      var z = zoomEls[j];
      var rz = z.getBoundingClientRect();
      var center = rz.top + rz.height / 2;
      var progress = (zStart - center) / (zStart - zEnd);
      progress = progress < 0 ? 0 : progress > 1 ? 1 : progress;
      z.style.opacity = String(progress);
      z.style.transform = 'scale(' + (0.72 + 0.28 * progress).toFixed(3) + ')';
    }
  }

  step();
  var running = true;
  function tick() {
    if (!running) return;
    step();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.addEventListener('beforeunload', function () { running = false; });
})();
`;

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function renderIntroOverlay(vm) {
  return `
  <div class="pq-intro-overlay" style="position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(165deg,#F6C9D6 0%,#F2D3E2 18%,#E7D7EC 38%,#D6E1F0 60%,#C3E7F3 82%,#BEEAF4 100%);cursor:pointer;transition:opacity .6s,visibility .6s">
    <div class="pq-brandmark">Prudential BSN Takaful</div>
    <div style="font-family:var(--serif);font-style:italic;font-size:26px;color:var(--teal);margin-top:18px">Anda Inspirasi Kami</div>
    <div style="font-size:12px;color:#7C88A0;letter-spacing:.1em;text-transform:uppercase;margin-top:28px">Tap anywhere to continue</div>
  </div>
  <button type="button" class="pq-sound-btn" style="position:fixed;top:16px;right:16px;z-index:50;background:rgba(11,37,69,.85);color:#fff;border:none;border-radius:100px;padding:10px 16px;font-family:var(--sans);font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;cursor:pointer;box-shadow:0 6px 16px rgba(11,37,69,.3)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
    <span class="pq-sound-label">Tap for sound</span>
  </button>`;
}

function renderHero(vm) {
  return `
  <section class="pq-hero">
    <div class="pq-reveal"><div class="pq-brandmark">Prudential BSN Takaful</div></div>
    <div class="pq-award pq-reveal d1">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C9962E" stroke-width="1.8"><path d="M12 2l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1.5z"></path></svg>
      Nation's Pride — Best Takaful Operator
    </div>
    <div class="pq-tagline pq-reveal d2">Anda Inspirasi Kami</div>
    <div class="pq-tagline-en pq-reveal d2">You are our inspiration</div>
    <div class="pq-hero-title pq-reveal d3">A ${textOr(vm.productName, 'Family Takaful')} plan, built around ${textOr(vm.clientName, 'you')}</div>
    <div class="pq-hero-sub pq-reveal d4">Prepared by ${textOr(vm.agentName, 'your servicing agent')}${vm.agencyName ? ` · ${escapeHtml(vm.agencyName)}` : ''}</div>
    <div class="pq-scroll-cue pq-reveal d4">Scroll to begin<br>↓</div>
  </section>`;
}

function renderQuestionHook(vm) {
  const name = vm.clientFirstName || 'you';
  return `
  <section>
    <div class="pq-eyebrow pq-reveal">A Question Before The Numbers</div>
    <div class="pq-headline pq-reveal d1" style="font-size:38px">What happens to your family, ${escapeHtml(name)}, if tomorrow doesn't go as planned?</div>
    <div class="pq-lede pq-reveal d2">A single hospital stay in Malaysia can cost more than 5 years of protection. This proposal makes sure you're never caught unprepared.</div>
    <div class="pq-stat-pill pq-reveal d3"><b>15%</b><span>medical inflation<br>in Malaysia, 2024</span></div>
    <div class="pq-scroll-cue pq-reveal d4" style="margin-top:56px">Scroll to continue<br>↓</div>
  </section>`;
}

function renderTwoPaths(vm) {
  const monthly = vm.monthlyCompact || 'your contribution';
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">Two Paths, ${escapeHtml(monthly)} a Month</div>
    <div class="pq-headline pq-reveal d1" style="font-size:26px">Where does the money go — and what happens when life doesn't wait?</div>
  </section>
  <section style="padding-top:0">
    <div class="pq-path-grid">
      <div class="pq-path-card pq-reveal d1">
        <div class="pq-path-label">Path A</div>
        <div class="pq-path-title">${escapeHtml(monthly)}/month → Savings Account</div>
        <div class="pq-path-desc">Money sits and waits — yours to keep, capped at what you've saved.</div>
      </div>
      <div class="pq-path-card pq-dark pq-reveal d2">
        <div class="pq-path-label">Path B</div>
        <div class="pq-path-title">${escapeHtml(monthly)}/month → Takaful Fund</div>
        <div class="pq-path-desc">Money is pooled into a shared fund — ready to pay far more than you put in.</div>
      </div>
    </div>
  </section>`;
}

function renderDrama(vm) {
  return `
  <section class="pq-drama">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getAccidentImage(), 'Accident scenario')}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-eyebrow pq-zoom">Then, an accident happens</div>
    <div class="pq-headline pq-zoom">The hospital needs <span class="pq-figure">RM100,000</span> — now.</div>
  </section>`;
}

function renderPathAConsequence(vm) {
  return `
  <section>
    <div class="pq-eyebrow pq-reveal" style="color:#B5493D">Path A — Saved At The Bank</div>
    <div class="pq-headline pq-reveal d1" style="font-size:26px">Without protection, the gap has to be found somewhere.</div>
    <div class="pq-consequence-steps">
      <div class="pq-consequence-step pq-reveal d1"><div class="pq-step-title">Step 1 — Sell what she can</div><div class="pq-step-desc">Jewellery, a vehicle, anything of value — liquidated fast, often below worth.</div></div>
      <div class="pq-consequence-step pq-reveal d2"><div class="pq-step-title">Step 2 — Still not enough</div><div class="pq-step-desc">Savings and sale proceeds combined still fall short.</div></div>
      <div class="pq-consequence-step pq-reveal d3"><div class="pq-step-title">Step 3 — Borrow from the bank</div><div class="pq-step-desc">A loan closes the gap — with interest, for years to come.</div></div>
      <div class="pq-consequence-step pq-warn pq-reveal d4"><div class="pq-step-title">Step 4 — If still not enough, ask family and friends</div><div class="pq-step-desc">Crowdfunding or borrowing from loved ones — during the hardest week of her life.</div></div>
    </div>
  </section>`;
}

function renderPathBOutcome(vm) {
  return `
  <section>
    <div class="pq-eyebrow pq-reveal">Path B — Protected By Takaful</div>
    <div class="pq-headline pq-reveal d1" style="font-size:26px">${escapeHtml(vm.clientFirstName || 'She')} doesn't make a single call.</div>
    <div class="pq-protected-card pq-reveal d2">
      <div class="pq-protected-figure">RM100,000 — settled cashless, at the hospital.</div>
      <div class="pq-protected-note">No selling, no borrowing, no asking. Her card carries the cost — she carries on recovering.</div>
    </div>
    <div class="pq-source-note pq-reveal d4" style="margin-top:20px">Illustrative only. Bank savings scenario assumes a typical Malaysian savings account rate; actual rates vary by bank. Medical coverage subject to waiting periods, panel hospital terms, and co-payment — see the sections below.</div>
  </section>`;
}

function renderQuotationSummary(vm) {
  return `
  <section class="pq-summary-card">
    <div class="pq-reveal" style="font-size:18px;color:var(--meta);font-weight:500">Prepared exclusively for</div>
    <div class="pq-summary-name pq-reveal d1">${textOr(vm.clientName, 'Client')}</div>
    <div class="pq-summary-rows pq-reveal d2">
      <div class="pq-summary-row"><span class="l">Plan</span><span class="r">${textOr(vm.productName)}</span></div>
      <div class="pq-summary-row"><span class="l">Monthly Total Amount Payable</span><span class="r">${vm.monthlyFormatted ? escapeHtml(vm.monthlyFormatted) : naSpan()}</span></div>
      <div class="pq-summary-row"><span class="l">Coverage Term</span><span class="r">${vm.basicPlanTerm != null ? `${vm.basicPlanTerm} Years` : naSpan()}</span></div>
    </div>
    <div class="pq-reveal d3" style="margin-top:44px;font-size:15px;color:var(--meta);line-height:1.5">
      Presented by <b style="color:var(--ink)">${textOr(vm.agentName, 'your servicing agent')}</b><br>
      ${vm.agentCode ? `Takaful Agent ${escapeHtml(vm.agentCode)}${vm.agencyName ? ` · ${escapeHtml(vm.agencyName)}` : ''}<br>` : ''}
      <span style="color:#7C88A0">Illustration only.</span>
    </div>
  </section>`;
}

function renderWhyThisMatters(vm) {
  const stats = [
    { figure: '15%', label: 'Medical inflation in Malaysia, 2024' },
    { figure: '<50%', label: 'Malaysians with any medical insurance' },
    { figure: 'RM553K', label: 'Average protection gap per family' },
    { figure: '55%+', label: 'Malaysians with no personal health insurance at all' },
    { figure: 'RM80K', label: 'Typical private heart-surgery bill' },
  ];
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">Why This Matters — Malaysia, 2026</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">The cost of getting sick is rising faster than most families can save.</div>
    <div class="pq-stat-grid">
      ${stats.map((s, i) => `
      <div class="pq-stat-card pq-reveal d${Math.min(i + 1, 4)}">
        <div>
          <div class="pq-stat-figure">${escapeHtml(s.figure)}</div>
          <div class="pq-stat-label">${escapeHtml(s.label)}</div>
        </div>
      </div>`).join('')}
    </div>
    <div class="pq-source-note pq-reveal d4">Sources: Aon-Hewitt (2024), Statista (2024), LIAM Underinsurance Study, Statista/Qoala (2023), NHMS 2019/PubMed underinsured study.</div>
  </section>`;
}

function renderOneDiagnosisAway(vm) {
  const bars = [
    { label: 'Heart Surgery', amount: 80000, pct: 100 },
    { label: 'Stroke Treatment', amount: 75000, pct: 94 },
    { label: 'Cancer Treatment', amount: 56000, pct: 70 },
    { label: 'Kidney Dialysis (per year)', amount: 36000, pct: 45 },
  ];
  const yourAmount = vm.totalAnnualContribution;
  const yourPct = yourAmount != null ? Math.max(1, Math.min(100, (yourAmount / 80000) * 100)) : null;
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">One Diagnosis Away</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">Typical private treatment costs for Malaysia's leading critical illnesses</div>
    <div class="pq-cost-list">
      ${bars.map((b, i) => `
      <div class="pq-cost-row pq-reveal d${Math.min(i + 1, 3)}">
        <div class="pq-cost-head"><span>${escapeHtml(b.label)}</span><span style="font-weight:700">${escapeHtml(moneyRM(b.amount))}</span></div>
        <div class="pq-cost-track"><div class="pq-cost-fill" style="width:${b.pct}%"></div></div>
      </div>`).join('')}
      ${yourAmount != null ? `
      <div class="pq-cost-row pq-reveal d4">
        <div class="pq-cost-head"><span>${textOr(vm.clientFirstName, 'You')} Pays / Year</span><span style="font-weight:700">${escapeHtml(moneyRM(yourAmount))}</span></div>
        <div class="pq-cost-track"><div class="pq-cost-fill pq-gold" style="width:${yourPct}%"></div></div>
      </div>` : ''}
    </div>
    <div class="pq-source-note pq-reveal d4">Sources: Statista/Qoala (2023), bluebricks.com.my.</div>
  </section>`;
}

function renderClientProfile(vm) {
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">A. Client Profile</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">This quotation is built around you</div>
    <div class="pq-profile-grid">
      <div class="pq-profile-item pq-wide pq-reveal d1"><div class="k">Name</div><div class="v">${textOr(vm.clientName)}</div></div>
      <div class="pq-profile-item pq-reveal d1"><div class="k">Age</div><div class="v">${vm.ageNextBirthday != null ? `${vm.ageNextBirthday} nbd · ${textOr(vm.gender)}` : naSpan()}</div></div>
      <div class="pq-profile-item pq-reveal d2"><div class="k">Smoker</div><div class="v">${textOr(vm.smokerStatus)}</div></div>
      <div class="pq-profile-item pq-reveal d2"><div class="k">Occupation</div><div class="v">${textOr(vm.occupationClass)}</div></div>
      <div class="pq-profile-item pq-reveal d3"><div class="k">Purpose</div><div class="v">${textOr(vm.purpose)}</div></div>
      <div class="pq-profile-item pq-wide pq-reveal d3"><div class="k">Payment Mode</div><div class="v">${textOr(vm.paymentMode)}</div></div>
    </div>
    <div class="pq-reveal d4" style="margin-top:24px;font-size:15px;color:var(--meta);line-height:1.5">Product: ${textOr(vm.productName)} — Regular Contribution Family Takaful. Shariah-compliant, participates in investment profit sharing.</div>
  </section>`;
}

function renderMedicalCardIntro(vm) {
  return `
  <section style="border-top:1px solid var(--line);padding-bottom:20px">
    <div class="pq-eyebrow pq-reveal">${textOr(vm.medicalRiderName, 'Medical Rider')}</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">Your medical card, in plain terms</div>
  </section>`;
}

function renderPlanExplainer(vm) {
  let headline;
  let body;
  if (vm.coverageModel === 'LIFETIME_MEDICAL_FUND') {
    const fundAmount = vm.lifetimeFundAmount != null ? moneyRM(vm.lifetimeFundAmount) : null;
    const sharing = vm.costSharingAfterExhaustion;
    headline = `${textOr(vm.planName, 'Your plan')} gives you ${textOr(fundAmount, 'a lifetime medical fund')} to draw on, for as long as you need it.`;
    body = `For ${vm.monthlyFormatted ? escapeHtml(vm.monthlyFormatted) : 'your monthly contribution'}, your medical card covers eligible hospitalisation and treatment against your ${textOr(fundAmount, 'lifetime medical fund')}${sharing ? ` — and even after it's fully used, PruBSN continues paying ${escapeHtml(String(sharing.insurerPct))}% of every further eligible claim, so you're never left facing the full bill alone.` : '.'}`;
  } else {
    // ANNUAL_LIMIT model - text unchanged from before the Medical Card
    // Engine refactor (only the tier-label source changed, to an
    // identical value - see buildViewModel's medical.planName comment).
    headline = `${textOr(vm.planName, 'Your plan')} gives you ${textOr(vm.annualLimit, 'protection')} a year to lean on.`;
    body = `For ${vm.monthlyFormatted ? escapeHtml(vm.monthlyFormatted) : 'your monthly contribution'}, your medical card covers eligible hospitalisation and treatment up to your ${textOr(vm.annualLimit, 'annual limit')}.`;
    if (vm.boost) {
      const conditionText = vm.boost.conditions.length ? vm.boost.conditions.join(', ') : 'a covered critical illness';
      headline = `${textOr(vm.planName, 'Your plan')} gives you ${textOr(vm.annualLimit, 'your annual limit')} a year, with a permanent boost of ${escapeHtml(vm.boost.amount)} if it turns serious.`;
      body = `For ${vm.monthlyFormatted ? escapeHtml(vm.monthlyFormatted) : 'your monthly contribution'}, your ${textOr(vm.annualLimit, 'annual limit')} automatically increases by ${escapeHtml(vm.boost.amount)} the moment you're diagnosed with ${escapeHtml(conditionText)} — permanently, every year after.`;
    }
  }
  return `
  <section style="padding-bottom:44px">
    <div class="pq-eyebrow pq-reveal">Your Plan — ${textOr(vm.planName)}</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">${headline}</div>
    ${vm.coverageExplanation ? `<div class="pq-lede pq-reveal d2" style="font-style:italic">${escapeHtml(vm.coverageExplanation)}</div>` : ''}
    <div class="pq-lede pq-reveal d2">${body}</div>
    <div class="pq-inline-photo-wrap pq-reveal d3">${imageWithFallback(AssetManager.getPlanImage(vm.medicalPlanTier), vm.planName || 'Plan', 'pq-inline-photo')}</div>
  </section>`;
}

function donutSegStyle(fraction, offsetSoFar, circ) {
  return `stroke-dashoffset:${(circ * (1 - fraction)).toFixed(1)};transform:rotate(${(offsetSoFar * 360).toFixed(1)}deg);transform-origin:100px 100px;`;
}

function renderContributionBreakdown(vm) {
  // This 3-way Protection/Wakalah/ISA contribution split is specific to
  // AnugerahMax's own account structure - Asas360's real contribution
  // structure (PUA/IUA investment-linked accounts) is out of Version 1's
  // medical-only scope (see extractors/asas360.js's header comment), so
  // there is nothing honest to show here for that product.
  if (vm.protectionContribution == null && vm.wakalahCertificateCharge == null && vm.isaContribution == null) return '';
  const protection = vm.protectionContribution || 0;
  const wakalah = vm.wakalahCertificateCharge || 0;
  const isa = vm.isaContribution || 0;
  const total = protection + wakalah + isa;
  const circ = 527.8;
  let seg1Style = '';
  let seg2Style = '';
  let seg3Style = '';
  if (total > 0) {
    const f1 = protection / total;
    const f2 = wakalah / total;
    const f3 = isa / total;
    seg1Style = `stroke-dashoffset:${(circ * (1 - f1)).toFixed(1)};`;
    seg2Style = donutSegStyle(f2, f1, circ);
    seg3Style = donutSegStyle(f3, f1 + f2, circ);
  }
  return `
  <section>
    <div class="pq-eyebrow pq-reveal">B. How Your Contribution Works</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">${vm.monthlyCompact ? escapeHtml(vm.monthlyCompact) : 'Your contribution'}, broken down</div>
    <div class="pq-donut-wrap pq-reveal d2">
      <svg viewBox="0 0 200 200" style="width:100%;height:100%;transform:rotate(-90deg)">
        <circle cx="100" cy="100" r="84" fill="none" stroke="#FFFFFF" stroke-width="26"></circle>
        <circle class="pq-donut-seg" data-final-offset="${(circ * (1 - (total ? protection / total : 0))).toFixed(1)}" cx="100" cy="100" r="84" fill="none" stroke="#0B2545" stroke-width="26" stroke-linecap="round" stroke-dasharray="${circ}" style="stroke-dashoffset:${circ};"></circle>
        <circle class="pq-donut-seg" cx="100" cy="100" r="84" fill="none" stroke="#178D93" stroke-width="26" stroke-linecap="round" stroke-dasharray="${circ}" style="${seg2Style}" data-visible></circle>
        <circle class="pq-donut-seg" cx="100" cy="100" r="84" fill="none" stroke="#C9962E" stroke-width="26" stroke-linecap="round" stroke-dasharray="${circ}" style="${seg3Style}" data-visible></circle>
      </svg>
      <div class="pq-donut-total"><div class="k">Total / month</div><div class="v">${vm.monthlyCompact ? escapeHtml(vm.monthlyCompact) : naSpan()}</div></div>
    </div>
    <div class="pq-contrib-list">
      <div class="pq-contrib-item pq-reveal d2"><span class="pq-contrib-dot" style="background:#0B2545"></span><div><div class="k">${moneyRM(protection) ? escapeHtml(moneyRM(protection)) : naSpan()} · Protection Contribution</div><div class="d">Funds your ${textOr(vm.medicalRiderName, 'medical rider')}.</div></div></div>
      <div class="pq-contrib-item pq-reveal d3"><span class="pq-contrib-dot" style="background:#178D93"></span><div><div class="k">${moneyRM(wakalah) ? escapeHtml(moneyRM(wakalah)) : naSpan()} · Wakalah Charge</div><div class="d">Certificate administration &amp; service fee.</div></div></div>
      <div class="pq-contrib-item pq-reveal d4"><span class="pq-contrib-dot" style="background:#C9962E"></span><div><div class="k">${moneyRM(isa) ? escapeHtml(moneyRM(isa)) : naSpan()} · Individual Special Account</div><div class="d">Your savings account — builds cash value over time.</div></div></div>
    </div>
  </section>`;
}

function renderKenBurnsAdmission(vm) {
  return `
  <section class="pq-kb-section" data-narrate="${escapeHtml(`The moment you're admitted, your ${vm.coverageHeadline || 'annual limit'} starts working for you.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getHospitalImage(), 'Hospital entrance')}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 1 — You're admitted</div>
      <div class="pq-headline pq-zoom">The moment you're admitted, your <span style="color:#4FD1D9">${textOr(vm.coverageHeadline, 'annual limit')}</span> starts working for you.</div>
    </div>
  </section>`;
}

function renderKenBurnsWard(vm) {
  const dayNote = vm.roomBoardDayNote ? escapeHtml(vm.roomBoardDayNote) : 'each rider year';
  return `
  <section class="pq-kb-section" data-narrate="${escapeHtml(`Your Hospital Room and Board benefit takes over from here, ${dayNote}.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getRoomBoardImage(vm.roomBoardAmount), 'Private hospital ward')}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 2 — You're moved to a ward</div>
      <div class="pq-headline pq-zoom">Your Hospital Room &amp; Board benefit takes over from here${vm.roomBoardDayNote ? ` — ${escapeHtml(vm.roomBoardDayNote)}` : ''}.</div>
    </div>
  </section>`;
}

function renderKenBurnsSurgery(vm) {
  const surgery = findBenefit(vm.benefitItems, 'Day Surgery');
  const covered = surgery && /as charged/i.test(surgery.value || '') ? 'as charged' : 'per your certificate terms';
  return `
  <section class="pq-kb-section" data-narrate="Surgical fees and in-hospital treatment are covered, cashless at panel hospitals.">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getSurgeryImage(), 'Operating theatre')}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">If surgery is needed</div>
      <div class="pq-headline pq-zoom">Surgical fees and in-hospital treatment are covered <span style="color:#4FD1D9">${escapeHtml(covered)}</span> — cashless at panel hospitals.</div>
    </div>
  </section>`;
}

function renderKenBurnsRoom(vm) {
  if (!vm.roomBoardAmount) return '';
  return `
  <section class="pq-kb-section" data-narrate="${escapeHtml(`Your Hospital Room and Board benefit covers ${vm.roomBoardAmount} a day, no need to touch your own savings.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getRecoveryImage(), 'Hospital room')}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-kb-figure">${escapeHtml(vm.roomBoardAmount)}<small>/day</small></div>
      <div class="pq-eyebrow pq-zoom" style="margin-top:20px">Step 3 — What that gets you</div>
      <div class="pq-headline pq-zoom" style="font-size:26px">Covered ${vm.roomBoardDayNote ? escapeHtml(vm.roomBoardDayNote) : 'per your certificate'} — no need to touch your own savings.</div>
    </div>
  </section>`;
}

function renderKenBurnsCriticalIllness(vm) {
  if (!vm.boost) return '';
  const conditionText = vm.boost.conditions.length ? vm.boost.conditions.join(', ') : 'a covered critical illness';
  return `
  <section class="pq-kb-section" data-narrate="${escapeHtml(`Diagnosed with ${conditionText}? Your annual limit gets a permanent boost of ${vm.boost.amount}, from the day of diagnosis onward.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getFinancialImage(), 'Critical illness financial protection')}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 4 — If it's serious</div>
      <div class="pq-headline pq-zoom">Diagnosed with <span style="color:#4FD1D9">${escapeHtml(conditionText)}</span>? Your limit gets a permanent boost.</div>
      <div class="pq-kb-figure">+${escapeHtml(vm.boost.amount)}</div>
      <div class="pq-kb-note">On top of your base ${textOr(vm.annualLimit, 'annual limit')} — permanently, every year, from the day of diagnosis onward.</div>
    </div>
  </section>`;
}

/**
 * LIFETIME_MEDICAL_FUND's counterpart to renderKenBurnsCriticalIllness
 * above - Health360-style plans have no critical-illness annual-limit-
 * doubling mechanic (there's no annual limit to double), but they do have
 * a real, materially important mechanic of their own: what happens once
 * the lifetime fund itself runs out. Uses only real, printed figures
 * (lifetimeFundAmount, the cost-sharing split) - never invented.
 */
function renderLifetimeFundSection(vm) {
  if (vm.coverageModel !== 'LIFETIME_MEDICAL_FUND') return '';
  const fundAmount = vm.lifetimeFundAmount != null ? moneyRM(vm.lifetimeFundAmount) : null;
  const sharing = vm.costSharingAfterExhaustion;
  return `
  <section class="pq-kb-section" data-narrate="${escapeHtml(`Your ${fundAmount || 'lifetime medical fund'} isn't a yearly limit - it's yours for as long as your certificate is in force.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getFinancialImage(), 'Lifetime medical fund')}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 4 — No yearly reset, no annual limit</div>
      <div class="pq-headline pq-zoom">Your fund carries over, year after year.</div>
      <div class="pq-kb-figure">${textOr(fundAmount, 'Lifetime fund')}</div>
      <div class="pq-kb-note">
        ${sharing
          ? `Unlike a plan that resets every policy year, this fund only runs down as you claim. If your eligible claims ever exceed it, PruBSN continues paying ${escapeHtml(String(sharing.insurerPct))}% of every further eligible cost — you're responsible for the remaining ${escapeHtml(String(sharing.clientPct))}%, subject to your certificate's terms.`
          : `Unlike a plan that resets every policy year, this fund only runs down as you actually claim against it.`}
      </div>
    </div>
  </section>`;
}

function renderEverythingElse(vm) {
  const items = vm.benefitItems || [];
  if (!items.length) return '';
  return `
  <section>
    <div class="pq-eyebrow pq-reveal">Everything else it covers</div>
    <div class="pq-benefit-list">
      ${items.map((item, i) => `
      <div class="pq-benefit-card pq-reveal d${Math.min((i % 4) + 1, 4)}">
        <svg class="pq-benefit-dot" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h4l2-6 4 12 2-6h4"></path></svg>
        <div>
          <div class="k">${escapeHtml(item.label)}</div>
          <div class="d">${item.value ? escapeHtml(item.value) : naSpan()}</div>
        </div>
      </div>`).join('')}
    </div>
    <div class="pq-source-note pq-reveal d4" style="margin-top:22px">Co-payment: ${textOr(vm.coPaymentOption, 'per certificate')} applies. Cashless facility available at PruBSN panel hospitals. Full terms in the certificate document.</div>
  </section>`;
}

function renderGuaranteedProtection(vm) {
  const facts = [];
  if (vm.productFacts.extensionToAge100) {
    facts.push({ k: 'Extension of Certificate Term', d: 'Can continue to age 100, cash value permitting.' });
  }
  if (vm.productFacts.pidmProtected) {
    facts.push({ k: 'PIDM Protected', d: "Protected by PIDM's TIPS, up to limits." });
  }
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">C. Guaranteed Protection</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">What is promised, regardless of markets</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getGuaranteeImage(), 'Guaranteed protection', 'pq-inline-photo')}</div>
    <div class="pq-guarantee-hero pq-reveal d2">
      <div class="pq-eyebrow">Death / TPD Benefit</div>
      <div class="pq-figure">${vm.guaranteedDeathTPDBenefit != null ? escapeHtml(moneyRM(vm.guaranteedDeathTPDBenefit)) : naSpan()}</div>
      ${vm.deathBenefitDescription ? `<div class="pq-note" style="margin-top:6px">${escapeHtml(vm.deathBenefitDescription)}</div>` : ''}
      <div class="pq-note">Paid if ${textOr(vm.clientFirstName, 'the covered person')} passes away or suffers Total Permanent Disability, before age ${vm.coverageToAge != null ? escapeHtml(String(vm.coverageToAge)) : naSpan()} next birthday.</div>
    </div>
    <div class="pq-fact-list">
      <div class="pq-fact-card pq-reveal d2"><div class="k">${vm.basicPlanTerm != null ? `${vm.basicPlanTerm}-Year Coverage Term` : 'Coverage Term'}</div><div class="d">${vm.coverageStartAge != null && vm.coverageToAge != null ? `Age ${escapeHtml(String(vm.coverageStartAge))} to age ${escapeHtml(String(vm.coverageToAge))} next birthday.` : naSpan()}</div></div>
      ${facts.map((f, i) => `<div class="pq-fact-card pq-reveal d${Math.min(i + 3, 4)}"><div class="k">${escapeHtml(f.k)}</div><div class="d">${escapeHtml(f.d)}</div></div>`).join('')}
    </div>
  </section>`;
}

function renderWaitingPeriods(vm) {
  if (!vm.waitingPeriods.length) return '';
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">Before Your Card Kicks In</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">Waiting periods you should know about</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getWaitingPeriodImage(), 'Waiting period', 'pq-inline-photo')}</div>
    <div class="pq-wait-list">
      ${vm.waitingPeriods.map((wp, i) => `
      <div class="pq-wait-card ${i === 0 ? 'pq-first' : ''} pq-reveal d${Math.min(i + 1, 4)}">
        <div class="k">${wp.days} Day${wp.days === 1 ? '' : 's'}</div>
        <div class="d">${escapeHtml(wp.description)}</div>
      </div>`).join('')}
    </div>
    <div class="pq-source-note pq-reveal d4">Source: PruBSN Product Disclosure Sheet, as extracted from this quotation's Product Illustration.</div>
  </section>`;
}

function renderCashValue(vm) {
  if (vm.cashValueX == null && vm.cashValueY == null) return '';
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">D. Non-Guaranteed Cash Value</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">How your Individual Special Account could grow</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getCashValueImage(), 'Cash value growth', 'pq-inline-photo')}</div>
    <div class="pq-reveal d2" style="margin-top:32px;position:relative">
      <svg viewBox="0 0 400 260" style="width:100%;height:auto;overflow:visible">
        <line x1="0" y1="240" x2="400" y2="240" stroke="rgba(11,37,69,0.15)" stroke-width="1"></line>
        <line x1="0" y1="150" x2="400" y2="150" stroke="rgba(11,37,69,0.08)" stroke-width="1"></line>
        <line x1="0" y1="60" x2="400" y2="60" stroke="rgba(11,37,69,0.08)" stroke-width="1"></line>
        <path class="pq-draw-path" data-final-offset="0" d="M0,240 L57,236 L114,232 L171,220 L229,193 L286,145 L343,84 L400,32" fill="none" stroke="#0B2545" stroke-width="4" stroke-linecap="round" stroke-dasharray="620" style="stroke-dashoffset:620"></path>
        <path class="pq-draw-path" data-final-offset="0" d="M0,240 L57,239 L114,237 L171,233 L229,222 L286,201 L343,167 L400,102" fill="none" stroke="#178D93" stroke-width="4" stroke-linecap="round" stroke-dasharray="620" style="stroke-dashoffset:620"></path>
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#7C88A0;margin-top:8px">
        <span>Year 1</span><span>Mid-term</span><span>${vm.basicPlanTerm != null ? `Year ${vm.basicPlanTerm} / Maturity` : 'Maturity'}</span>
      </div>
    </div>
    <div class="pq-cashvalue-legend pq-reveal d3">
      ${vm.cashValueY != null ? `<div class="pq-cv-row"><span class="pq-cv-dot" style="background:#0B2545"></span><span style="font-size:15px;font-weight:600">Scenario Y (5% p.a.): ${escapeHtml(moneyRM(vm.cashValueY))}</span></div>` : ''}
      ${vm.cashValueX != null ? `<div class="pq-cv-row"><span class="pq-cv-dot" style="background:#178D93"></span><span style="font-size:15px;font-weight:600">Scenario X (2% p.a.): ${escapeHtml(moneyRM(vm.cashValueX))}</span></div>` : ''}
    </div>
    <div class="pq-source-note pq-reveal d4" style="margin-top:24px">Illustrative only — not guaranteed. You may only receive the guaranteed death benefit upon death.</div>
  </section>`;
}

function renderFullPicture(vm) {
  const cards = [
    { k: 'Contribution Paid', v: vm.totalContributionOverTerm != null ? moneyRM(vm.totalContributionOverTerm) : null, s: vm.basicPlanTerm != null ? `${vm.basicPlanTerm} years total` : '' },
    { k: 'Guaranteed Benefit', v: vm.guaranteedDeathTPDBenefit != null ? moneyRM(vm.guaranteedDeathTPDBenefit) : null, s: 'Death / TPD' },
    { k: 'Cash Value (Y)', v: vm.cashValueY != null ? moneyRM(vm.cashValueY) : null, s: 'At maturity', accent: true },
    { k: 'Medical Coverage', v: vm.coverageHeadline, s: vm.coverageModel === 'LIFETIME_MEDICAL_FUND' ? 'Lifetime medical fund' : 'Annual limit' },
  ];
  if (cards.every((c) => c.v == null)) return '';
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">E. The Full Picture</div>
    <div class="pq-headline pq-reveal d1">${vm.basicPlanTerm != null ? `${vm.basicPlanTerm} years, at a glance` : 'At a glance'}</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getCoverageImage(vm.coverageHeadline), 'Medical coverage', 'pq-inline-photo')}</div>
    <div class="pq-summary4">
      ${cards.map((c, i) => `
      <div class="pq-summary4-card ${c.accent ? 'pq-accent' : ''} pq-reveal d${Math.min(i + 1, 4)}">
        <div class="k">${escapeHtml(c.k)}</div>
        <div class="v">${c.v ? escapeHtml(c.v) : naSpan()}</div>
        <div class="s">${escapeHtml(c.s)}</div>
      </div>`).join('')}
    </div>
    <div class="pq-source-note pq-reveal d4" style="margin-top:24px">Illustrative only — actual values depend on real fund performance.</div>
  </section>`;
}

function renderReadyWhenYouAre(vm) {
  return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">Ready When You Are</div>
    <div class="pq-headline pq-reveal d1" style="font-size:34px">Let's protect what you've worked for — before life asks you to.</div>
    <div class="pq-steps">
      <div class="pq-step-card pq-reveal d1"><div class="k">Step 1</div><div class="v">Confirm your details &amp; health declaration</div></div>
      <div class="pq-step-card pq-reveal d2"><div class="k">Step 2</div><div class="v">Sign the proposal form</div></div>
      <div class="pq-step-card pq-reveal d3"><div class="k">Step 3</div><div class="v">First contribution &amp; certificate issued</div></div>
    </div>
    <div class="pq-agent-footer pq-reveal d4">
      ${vm.agencyLogo ? `<img src="${escapeHtml(vm.agencyLogo)}" alt="${escapeHtml(vm.agencyName || 'Agency')}">` : ''}
      <div>
        <div class="name">${textOr(vm.agentName, 'Your servicing agent')}</div>
        <div class="meta">${vm.agentCode ? `Takaful Agent ${escapeHtml(vm.agentCode)}` : ''}${vm.agencyName ? ` · ${escapeHtml(vm.agencyName)}` : ''} · Prudential BSN Takaful Berhad</div>
        <div class="fine">This is a product illustration for discussion purposes only. Not a certificate document.</div>
      </div>
    </div>
  </section>`;
}

function renderContactSection(vm) {
  return `
  <section style="border-top:1px solid var(--line);padding-bottom:calc(env(safe-area-inset-bottom) + 80px)">
    <div class="pq-eyebrow pq-reveal">One Last Thing</div>
    <div class="pq-headline pq-reveal d1" style="font-size:34px">Thank you for taking the time${vm.clientFirstName ? `, ${escapeHtml(vm.clientFirstName)}` : ''}.</div>
    <div class="pq-lede pq-reveal d1">This proposal reflects real numbers, real coverage, and a real conversation between us — no fine print surprises. When you're ready to move forward, continue your application below.</div>
    <div class="pq-contact-fields">
      <div class="pq-contact-field pq-reveal d2"><input id="pq-name" type="text" placeholder="Full name (as per IC)" value="${escapeHtml(vm.clientName || '')}"></div>
      <div class="pq-contact-field pq-reveal d2"><input id="pq-ic" type="text" placeholder="IC number"></div>
      <div class="pq-contact-field pq-reveal d3"><input id="pq-phone" type="tel" placeholder="Phone number"></div>
      <div class="pq-contact-field pq-reveal d3"><input id="pq-email" type="email" placeholder="Email address"></div>
    </div>
    <button type="button" id="paf-continue-btn" class="pq-cta">Continue Application &rarr;</button>
    <div class="pq-contact-note pq-reveal d4">Your details stay with your agent — nothing is sent anywhere else until you submit the application below.</div>
  </section>`;
}

function renderOutro() {
  return `
  <section class="pq-outro">
    <div class="pq-outro-badge">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2"><path d="M20 6L9 17l-5-5"></path></svg>
    </div>
    <div class="pq-outro-tagline">Anda Inspirasi Kami</div>
    <div class="pq-outro-sub">Prudential BSN Takaful</div>
  </section>`;
}

/**
 * @param {object} data the `data` object from parseQuotation()'s
 *   { data, warnings, errors } return value
 * @param {{quotationNumber?: string, validUntilIso?: string}} agentReview
 * @returns {string} a complete, standalone HTML document
 */
function renderNarrativeQuotationHtml(data, agentReview = {}) {
  const vm = buildViewModel(data, agentReview);
  const clientName = vm.clientName || 'Client';

  const sections = [
    renderHero(vm),
    renderQuestionHook(vm),
    renderTwoPaths(vm),
    renderDrama(vm),
    renderPathAConsequence(vm),
    renderPathBOutcome(vm),
    renderQuotationSummary(vm),
    renderWhyThisMatters(vm),
    renderOneDiagnosisAway(vm),
    renderClientProfile(vm),
    renderMedicalCardIntro(vm),
    renderPlanExplainer(vm),
    renderContributionBreakdown(vm),
    renderKenBurnsAdmission(vm),
    renderKenBurnsWard(vm),
    renderKenBurnsSurgery(vm),
    renderKenBurnsRoom(vm),
    renderKenBurnsCriticalIllness(vm),
    renderLifetimeFundSection(vm),
    renderEverythingElse(vm),
    renderGuaranteedProtection(vm),
    renderWaitingPeriods(vm),
    renderCashValue(vm),
    renderFullPicture(vm),
    renderReadyWhenYouAre(vm),
    renderContactSection(vm),
    renderOutro(),
  ].join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quotation — ${escapeHtml(clientName)}</title>
<style>${NARRATIVE_STYLE}</style>
<div id="pq-doc">
  ${renderIntroOverlay(vm)}
  ${sections}
</div>
<script>${NARRATIVE_RUNTIME}</script>
`;
}

module.exports = { renderNarrativeQuotationHtml, buildViewModel, RENDERER_VERSION };
