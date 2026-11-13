/**
 * storyModel.js
 *
 * Turns one parsed quotation (parseQuotation()'s `data`) into the small,
 * product-neutral set of facts the story deck talks about: who it's for,
 * what it costs, the medical card's limit model, a handful of headline
 * benefits, waiting periods and the cash value illustration.
 *
 * It reads the parser's normalised `medical` and `protection` blocks
 * first (shared by every product), and only falls back to product-shaped
 * fields where those don't carry a figure. A fact that can't be found is
 * `null`, and every scene that would need it is simply left out - the
 * deck never invents a number.
 */

'use strict';

const { formatDateLong } = require('../formatters.js');

const MALAY_PREFIXES = new Set(['muhammad', 'muhamad', 'mohammad', 'mohamad', 'mohamed', 'mohd', 'mohd.', 'md', 'md.', 'ahmad', 'abdul', 'abd', 'nur', 'nurul', 'siti', 'wan', 'nik', 'tengku', 'syed', 'sharifah', 'che', 'puteri', 'raja', 'megat', 'noor', 'nor']);

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\bBin\b/g, 'Bin').replace(/\bBinti\b/g, 'Binti');
}

/** The name people actually call someone: "Muhammad Syafiq Bin Zainudin" -> "Syafiq". */
function callName(fullName) {
  const words = titleCase(fullName).split(/\s+/).filter(Boolean);
  const cut = words.findIndex((w) => /^(bin|binti|bt|b\.|a\/l|a\/p)$/i.test(w));
  const given = cut > 0 ? words.slice(0, cut) : words;
  let i = 0;
  while (i < given.length - 1 && MALAY_PREFIXES.has(given[i].toLowerCase())) i++;
  return given[i] || words[0] || '';
}

/** First RM amount in a benefit value: "including: RM1,000,000 per lifetime ..." -> 1000000. */
function firstAmount(value) {
  if (!value) return null;
  const m = String(value).match(/RM\s*([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

function money(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return firstAmount(v);
}

function findItem(items, re) {
  return (items || []).find((it) => re.test(it.label || '')) || null;
}

function coPayInfo(raw) {
  const s = String(raw || '').trim();
  if (!s || /^none$/i.test(s)) return { label: null, amount: null, kind: 'none' };
  const amount = money(s.replace(/^[^\d]*/, 'RM'));
  if (/smart\s*saver/i.test(s)) return { label: s.replace(/\s+/g, ''), amount, kind: 'smartsaver' };
  if (/deductible/i.test(s)) return { label: s, amount, kind: 'deductible' };
  return { label: s, amount, kind: 'other' };
}

function sortedWaiting(list) {
  const seen = new Set();
  return (list || [])
    .filter((w) => w && Number.isFinite(w.days) && w.days > 0)
    .sort((a, b) => a.days - b.days)
    .filter((w) => {
      const key = `${w.days}|${w.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * @param {object} data parseQuotation()'s `data`
 * @param {object} product the matched product profile (see products/index.js)
 */
function buildStoryModel(data, product) {
  const d = data || {};
  const meta = d.metadata || {};
  const client = d.client || {};
  const contributions = d.contributions || {};
  const medical = d.medical || {};
  const protection = d.protection || {};
  const plan = d.plan || d.basicPlan || {};

  const parent = client.parent && client.parent.fullName ? client.parent : null;
  const isChild = !!parent || (Number.isFinite(client.ageNextBirthday) && client.ageNextBirthday <= 17);
  const unborn = isChild && (!client.fullName || /^child$/i.test(String(client.fullName).trim()));
  const fullName = unborn ? '' : titleCase(client.fullName || '');
  const parentName = parent ? titleCase(parent.fullName) : '';

  const monthly = Number.isFinite(contributions.totalMonthlyContribution) ? contributions.totalMonthlyContribution
    : Number.isFinite(d.monthlyTotalAmountPayable) ? d.monthlyTotalAmountPayable : null;
  const annual = Number.isFinite(contributions.totalAnnualContribution) ? contributions.totalAnnualContribution
    : Number.isFinite(d.totalAnnualContribution) ? d.totalAnnualContribution
      : monthly != null ? monthly * 12 : null;
  const term = plan.basicPlanTerm || protection.basicPlanTerm || null;
  const coverageToAge = medical.coverageToAge || plan.coverageToAge || null;
  // Only the quotation's own printed total: multiplying today's annual
  // contribution by the term would be wrong for plans whose contribution
  // term or amount changes over time.
  const totalOverTerm = Number.isFinite(contributions.totalContributionOverTerm) ? contributions.totalContributionOverTerm : null;

  const items = medical.benefitItems || [];
  const value = (re) => { const it = findItem(items, re); return it ? it.value : null; };
  const amount = (re) => firstAmount(value(re));

  const annualLimit = money(medical.annualLimit);
  const lifetimeFund = Number.isFinite(medical.lifetimeFundAmount) ? medical.lifetimeFundAmount : null;
  const room = medical.roomAndBoard || {};
  const tierMatch = String(medical.planName || '').match(/(\d{2,4})\s*$/);

  // Cash value: a full illustration table where the product prints one,
  // otherwise just the end-of-term figures.
  const cv = protection.cashValue || {};
  let cashPoints = null;
  if (Array.isArray(cv.schedule) && cv.schedule.length >= 3) {
    cashPoints = cv.schedule
      .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.cashValueScenarioX) && Number.isFinite(r.cashValueScenarioY))
      .map((r) => [r.year, r.cashValueScenarioX, r.cashValueScenarioY]);
  }
  const lastRow = cashPoints && cashPoints.length ? cashPoints[cashPoints.length - 1] : null;
  const cashAtEnd = {
    x: Number.isFinite(cv.scenarioX) ? cv.scenarioX : lastRow ? lastRow[1] : null,
    y: Number.isFinite(cv.scenarioY) ? cv.scenarioY : lastRow ? lastRow[2] : null,
  };

  const projection = d.projection && Array.isArray(d.projection.projectionRows)
    ? d.projection.projectionRows.filter((r) => Number.isFinite(r.age) && Number.isFinite(r.currentContribution))
    : [];

  // Monthly breakdown, only where the quotation prints the parts.
  const breakdown = [];
  if (monthly != null && Number.isFinite(contributions.medicTotalCareContribution)) {
    breakdown.push({ key: 'medical', amount: contributions.medicTotalCareContribution });
    if (Number.isFinite(contributions.isaContribution)) breakdown.push({ key: 'basic', amount: contributions.isaContribution });
    if (Number.isFinite(contributions.wakalahCertificateCharge)) breakdown.push({ key: 'wakalah', amount: contributions.wakalahCertificateCharge });
    const rest = Math.round((monthly - breakdown.reduce((s, b) => s + b.amount, 0)) * 100) / 100;
    if (rest > 0.5) breakdown.push({ key: 'riders', amount: rest });
    if (rest < -0.5) breakdown.length = 0; // parts don't add up - don't show a wrong split
  }

  return {
    product,
    productName: meta.productName || product.name,
    quoteDateIso: meta.quotationDate && meta.quotationDate.iso,
    quoteDate: meta.quotationDate && meta.quotationDate.iso ? formatDateLong(meta.quotationDate.iso) : null,
    version: meta.quotationVersion || null,
    agentCode: d.agent && d.agent.agentCode,
    agentNameOnDocument: d.agent && d.agent.agentNameOnDocument,

    isChild,
    unborn,
    fullName,
    callName: unborn ? '' : callName(fullName),
    parentName,
    parentCallName: parentName ? callName(parentName) : '',
    gender: client.gender || null,
    age: Number.isFinite(client.ageNextBirthday) ? client.ageNextBirthday : null,
    smoker: client.smokerStatus || null,
    occupationClass: client.occupationClass || null,

    monthly,
    annual,
    term,
    coverageToAge,
    totalOverTerm,
    breakdown,

    medical: {
      riderName: medical.riderName || null,
      planName: medical.planName || null,
      tier: tierMatch ? tierMatch[1] : medical.planTier || null,
      model: medical.coverageModel || (lifetimeFund ? 'LIFETIME_MEDICAL_FUND' : annualLimit ? 'ANNUAL_LIMIT' : null),
      annualLimit,
      lifetimeFund,
      lifetimeLimitText: medical.lifetimeLimit || null,
      coShare: medical.costSharingAfterExhaustion || null,
      roomRate: Number.isFinite(room.amount) ? room.amount : amount(/room\s*(&|and)\s*board/i),
      roomDays: Number.isFinite(room.maxDaysPerYear) ? room.maxDaysPerYear : null,
      roomUnlimited: /unlimited/i.test(value(/room\s*(&|and)\s*board/i) || ''),
      coPay: coPayInfo(medical.coPayment),
      contribution: Number.isFinite(medical.contribution) ? medical.contribution : null,
      outpatientCancer: amount(/outpatient cancer/i),
      extraLimit: amount(/additional annual limit/i),
      advancedTreatment: /advanced medical treatment/i.test(value(/outpatient cancer/i) || '') ? firstAmount((value(/outpatient cancer/i) || '').split(/advanced medical treatment/i)[1]) : null,
      dengue: amount(/dengue/i),
      childIllness: amount(/top child illness/i),
      parentAllowance: amount(/parents? allowance/i),
      govHospital: amount(/government hospital/i),
      accidentEmergency: value(/emergency outpatient.*accident/i),
      homeNursing: value(/home nursing/i),
      lens: amount(/intraocular lens/i),
      vaccination: amount(/vaccination/i),
      secondOpinion: amount(/second medical opinion/i) || firstAmount(((value(/dengue/i) || '').split(/second medical opinion/i)[1]) || ''),
      worldwide: /yes/i.test(value(/worldwide/i) || ''),
      postHospDays: (String(value(/post-?hospitali[sz]ation/i) || '').match(/within (\d+) days/i) || [])[1] || null,
      preHospDays: (String(value(/pre-?hospitali[sz]ation/i) || '').match(/within (\d+) days/i) || [])[1] || null,
      waiting: sortedWaiting(medical.waitingPeriods),
    },

    protection: {
      sumCovered: protection.basicSumCovered || plan.basicSumCovered || null,
      death: protection.deathBenefit && Number.isFinite(protection.deathBenefit.amount) ? protection.deathBenefit.amount : null,
    },

    cash: { points: cashPoints, atEnd: cashAtEnd },
    projection,
    inflationLow: d.projection ? d.projection.medicalInflationAssumptionLow : null,
    inflationHigh: d.projection ? d.projection.medicalInflationAssumptionHigh : null,
  };
}

module.exports = { buildStoryModel, callName, titleCase, firstAmount };
