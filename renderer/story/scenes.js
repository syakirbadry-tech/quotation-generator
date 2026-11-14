/**
 * scenes.js
 *
 * Every scene of the story deck, as a function of the story model(s).
 * A scene returns '' when the quotation doesn't carry the facts it needs,
 * so the deck simply skips it rather than showing a guess.
 *
 * Copy rules (kept from the hand-built decks):
 *  - plan figures come only from the client's own quotation;
 *  - market statistics carry their source on the slide;
 *  - illustrative numbers (the RM60,000 bill) are labelled as such;
 *  - limits and exclusions are said out loud, not hidden.
 */

'use strict';

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-MY', { maximumFractionDigits: 2 });
const rm = (n) => (n == null ? '' : `RM${fmt(n)}`);
const rmShort = (n) => (n >= 1000000 ? `RM${fmt(n / 1000000)}m` : n >= 1000 ? `RM${fmt(n / 1000)}k` : rm(n));
const notes = (...ps) => `<div class="notes">${ps.filter(Boolean).map((p) => `<p>${p}</p>`).join('')}</div>`;
const count = (n, prefix = 'RM', suffix = '') => `data-count="${Math.round(n)}" data-prefix="${prefix}" data-suffix="${suffix}"`;

function section(label, inner, { night = false, photo = null, center = false } = {}, notesHtml = '') {
  const cls = ['slide', night || photo ? 'night' : '', photo ? 'photo-bg' : ''].filter(Boolean).join(' ');
  const style = photo ? ` style="--bg:url(${esc(photo)})"` : '';
  return `<section class="${cls}" data-label="${esc(label)}"${style}><div class="inner${center ? ' center' : ''}">${inner}</div>${notesHtml}</section>`;
}

function chips(group, label, options, { multi = false, summary = label, extra = '' } = {}) {
  const id = `lbl-${group}`;
  return `<span class="chip-label" id="${id}">${esc(label)}</span>
<div class="chips" role="group" aria-labelledby="${id}" data-group="${group}" data-label="${esc(summary)}"${multi ? ' data-multi="true"' : ''}>${options.map((o) => {
    const opt = typeof o === 'string' ? { val: o } : o;
    return `<button class="chip" type="button" aria-pressed="false" data-val="${esc(opt.val)}"${opt.text ? ` data-text="${esc(opt.text)}"` : ''}${opt.alone ? ' data-alone' : ''}${opt.card ? ' data-card' : ''}>${esc(opt.label || opt.val)}</button>`;
  }).join('')}</div>${extra}`;
}

/** What the medical card's headline limit is, in words and as a number. */
function limitOf(m) {
  if (m.medical.model === 'LIFETIME_MEDICAL_FUND' && m.medical.lifetimeFund) {
    return { amount: m.medical.lifetimeFund, short: `${rm(m.medical.lifetimeFund)} medical fund`, long: `a ${rm(m.medical.lifetimeFund)} lifetime medical fund` };
  }
  if (m.medical.annualLimit) {
    return { amount: m.medical.annualLimit, short: `${rm(m.medical.annualLimit)} a year`, long: `up to ${rm(m.medical.annualLimit)} a year` };
  }
  return null;
}

function coPayLine(m) {
  const c = m.medical.coPay;
  if (c.kind === 'smartsaver' && c.amount) return { you: `the first <span class="hl">${rm(c.amount)}</span>`, fine: `after the ${esc(c.label)} co-payment of ${rm(c.amount)} per disability` };
  if (c.kind === 'deductible' && c.amount) return { you: `the <span class="hl">${rm(c.amount)}</span> deductible`, fine: `after the ${rm(c.amount)} deductible` };
  if (c.label) return { you: 'the co-payment', fine: `after the ${esc(c.label)} co-payment` };
  return null;
}

// ---------- Opening ----------

function intro(m, ctx) {
  return section('Intro', `
<div class="brand">
  <svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="40"/><path class="leaf" d="M50 26c12 10 14 26 0 40-14-14-12-30 0-40z"/></svg>
  <div class="eyebrow">${esc(ctx.agent.agency)}</div>
</div>
<div class="tagline rv d1">${esc(ctx.agent.tagline)}</div>
<div class="tap-hint rv d3">Tap to begin →</div>`, { center: true }, notes('Keep this screen up while you say hello. Move on when they’re relaxed.', 'Press N or tap Notes any time to show or hide these notes.'));
}

function cover(m, ctx) {
  const hon = m.gender === 'Female' ? 'Puan' : m.gender === 'Male' ? 'Encik' : '';
  let h1;
  let forLine;
  if (m.unborn) {
    h1 = `Protection ready <span class="hl">before day one</span>`;
    forLine = m.parentName ? `Tailor-made for <b>${esc(m.parentName)}</b> and her little one` : 'Tailor-made for your little one';
  } else if (m.isChild) {
    h1 = `A takaful plan built around <span class="hl">${esc(m.callName)}</span>`;
    forLine = m.parentName ? `Tailor-made for <b>${esc(m.fullName)}</b>, prepared for ${esc(m.parentName)}` : `Tailor-made for <b>${esc(m.fullName)}</b>`;
  } else {
    h1 = `A takaful plan built around <span class="hl">${esc(m.callName)}</span>`;
    forLine = `Tailor-made for <b>${esc([hon, m.fullName].filter(Boolean).join(' '))}</b>`;
  }
  const facts = [
    m.age != null && !m.unborn ? `${m.age} next birthday` : null,
    m.occupationClass && !m.isChild ? `Occupation ${m.occupationClass.toLowerCase()}` : null,
    m.quoteDate ? `Quotation dated ${m.quoteDate}` : null,
  ].filter(Boolean).join(' · ');
  return section('Cover', `
<svg class="cond-art" viewBox="0 0 160 170" aria-hidden="true">
  <path class="soft" d="M80 10 l62 24 v44 c0 42 -28 68 -62 82 c-34 -14 -62 -40 -62 -82 v-44z"/>
  <path class="ln" d="M80 10 l62 24 v44 c0 42 -28 68 -62 82 c-34 -14 -62 -40 -62 -82 v-44z"/>
  <circle class="ln" cx="80" cy="62" r="15"/>
  <path class="ln" d="M52 128 c0 -26 12 -42 28 -42 c16 0 28 16 28 42"/>
  <path class="gold pulse" d="M80 150 c-7 -5 -11 -9 -11 -13 c0 -3 2 -5 5 -5 c2 0 4 1 6 3 c2 -2 4 -3 6 -3 c3 0 5 2 5 5 c0 4 -4 8 -11 13z"/>
</svg>
<span class="badge rv">★ ${esc(m.productName)}${m.medical.planName ? ` · ${esc(m.medical.planName)}` : ''}</span>
<h1 class="rv d1">${h1}</h1>
<div class="cover-for rv d2">${forLine}</div>
${facts ? `<p class="rv d2">${esc(facts)}</p>` : ''}
<div class="agent-line rv d3">Prepared by ${esc(ctx.agent.name)} · ${esc(ctx.agent.agency)}</div>`, { center: true }, notes('Set expectations: “I’ll share some real numbers and a short story, then I want to hear from you. After that we go through your plan step by step, and the decision is yours.”'));
}

function agenda(m) {
  return section('Today', `
<div class="eyebrow rv">How we’ll spend our time</div>
<h2 class="rv d1">Four parts, about 45 minutes</h2>
<div class="agenda">
  <div class="ag rv d2"><div class="n">1</div><div><b>What the numbers say</b><span>Protection in Malaysia and how fast medical costs are rising</span></div></div>
  <div class="ag rv d3"><div class="n">2</div><div><b>A tale of two paths</b><span>Same ${rm(m.monthly)} a month, two very different outcomes</span></div></div>
  <div class="ag rv d4"><div class="n">3</div><div><b>Your turn to talk</b><span>Your situation, your worries, your budget. I listen first.</span></div></div>
  <div class="ag rv d5"><div class="n">4</div><div><b>Your plan, step by step</b><span>Hospital, limits, costs and options</span></div></div>
</div>
<div class="promise rv d6"><b>My promise:</b> you decide. My job is to make the choice clear, including the limits.</div>`, {}, notes('Say: “If anything doesn’t fit your situation, stop me. This is a conversation, not a lecture.”'));
}

// ---------- What the numbers say (market facts, sourced) ----------

function protectedStat() {
  return section('Who is protected', `
<div class="eyebrow rv">How many Malaysians are protected?</div>
<svg class="people rv d1" viewBox="0 0 520 120" role="img" aria-label="20 figures, 9 highlighted: about 45 percent insured"><g id="peopleGrid"></g></svg>
<div class="kb-fig num rv d2" ${count(45, '~', '%')}>~45%</div>
<h2 class="rv d3">of Malaysians are insured, counting takaful. <span class="hl">More than half are not.</span></h2>
<div class="glance two" style="width:100%">
  <div class="tile rv d4"><div class="k">No protection at all</div><div class="v num" ${count(30, '', '%')}>30%</div><div class="s">of working Malaysians aged 25 to 40</div><div class="src">Zurich Malaysia survey, 1,201 people, late 2021</div></div>
  <div class="tile rv d5"><div class="k">Takaful penetration</div><div class="v num">19.6%</div><div class="s">of Malaysians, takaful only, 2025</div><div class="src">Malaysian Takaful Association, June 2026</div></div>
</div>
<p class="fine rv d6">~45%: LIAM CEO Mark O’Dell, April 2024. Less than half of workers have a company group plan (LIAM, Budget 2026 proposals), and group cover usually ends when the job ends.</p>`, { night: true, center: true }, notes('Ask before revealing: “Out of every 10 Malaysians, how many do you think have life insurance or family takaful?”', 'Accuracy: 45% is a spoken estimate from LIAM’s CEO, not an official BNM statistic.'));
}

function underinsured() {
  return section('Underinsured', `
<div class="eyebrow rv">Covered is not the same as enough</div>
<h2 class="rv d1">Most insured families are <span class="hl">underinsured</span></h2>
<div class="under rv d2">
  <div class="under-track" aria-hidden="true"><div class="under-fill"></div></div>
  <div class="under-labels"><span>Out of 100 insured families…</span><span class="num"><b>94 to 98</b> don’t have enough cover</span></div>
</div>
<div class="glance two">
  <div class="tile navy rv d3"><div class="k">Chance of being underinsured</div><div class="v num">94–98%</div><div class="s">for an insured Malaysian family</div></div>
  <div class="tile rv d4"><div class="k">Average shortfall</div><div class="v num">RM100k–150k</div><div class="s">per family member</div></div>
</div>
<p class="fine rv d5">Source: Underinsurance Study by Universiti Kebangsaan Malaysia and the Life Insurance Association of Malaysia (2012/13), cited by Bank Negara Malaysia. It is still the main national study on underinsurance; medical costs have risen sharply since.</p>`, {}, notes('Key message: having a policy doesn’t mean enough protection.', 'Be upfront about the date: it’s the latest big national study, and costs have risen since.'));
}

function inflation() {
  return section('Medical inflation', `
<div class="eyebrow rv">Medical inflation, projected for 2026</div>
<h2 class="rv d1">Malaysia’s medical costs are rising <span class="hl">faster than the world’s</span></h2>
<div class="hbars rv d2" aria-label="Medical trend rate 2026: Malaysia 16 percent, Asia Pacific 11.3 percent, global 10.3 percent">
  <div class="hrow"><span class="lbl">Malaysia</span><div class="htrack"><div class="hbar hi" style="width:100%"></div></div><span class="val num">16%</span></div>
  <div class="hrow"><span class="lbl">Asia Pacific</span><div class="htrack"><div class="hbar" style="width:70.6%"></div></div><span class="val num">11.3%</span></div>
  <div class="hrow"><span class="lbl">Global</span><div class="htrack"><div class="hbar lo" style="width:64.4%"></div></div><span class="val num">10.3%</span></div>
</div>
<p class="rv d3">Malaysia held at 15% for three years. 2026 is projected to be the highest since 2021.</p>
<p class="fine rv d4">Medical trend rate = yearly rise in medical cost per insured person. Malaysia and Asia Pacific: Aon Global Medical Trend Rates Report 2026. Global: WTW Global Medical Trends Survey 2026.</p>`, {}, notes('If they mention the government’s much lower figure (DOSM health inflation about 3% in 2025): that measures prices of a basket of health items; the medical trend rate measures total cost per insured patient. Both are true.'));
}

function yourMedicalCost(m) {
  const rows = m.projection;
  if (rows.length < 3) return '';
  const high = (r) => r.projected10pct || r.projected7pct || r.currentContribution;
  const max = Math.max(...rows.map(high));
  const pct = (v) => `${Math.max(4, (v / max) * 100).toFixed(1)}%`;
  const who = m.unborn ? 'your child' : m.callName;
  return section('Your medical cost', `
<div class="eyebrow rv">From your own quotation</div>
<h2 class="rv d1">Medical cost keeps rising. Will savings keep up${who ? `, <span class="hl">${esc(who)}</span>` : ''}?</h2>
<p class="rv d2">Your quotation projects the yearly cost of the medical plan if medical inflation continues.</p>
<div class="bars bars5 rv d3" aria-label="Projected yearly medical plan contribution by age">
${rows.slice(0, 6).map((r) => `<div class="bar-col"><div class="bar-val num">${rm(high(r))}</div><div class="bar-pair">${r.projected7pct ? `<div class="bar thin" style="height:${pct(r.projected7pct)}"></div><div class="bar thin hi" style="height:${pct(high(r))}"></div>` : `<div class="bar thin" style="height:${pct(r.currentContribution)}"></div>`}</div><div class="bar-age">Age ${r.age}</div></div>`).join('')}
</div>
<div class="legend rv d4"><span><i style="background:var(--teal)"></i>${esc(m.inflationLow || 7)}% medical inflation</span><span><i style="background:var(--coral)"></i>${esc(m.inflationHigh || 10)}% medical inflation</span></div>
<p class="fine rv d5">Source: Takaful Contribution Projection Table for Medical Plan, PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ''}. Current cost ${rm(rows[0].currentContribution)} a year at age ${rows[0].age}. Values above the bars are the higher-inflation case. Illustration only.</p>`, {}, notes('This is their own quotation, not a generic number. Medical cost goes up whether or not they have a plan; the question is who pays it.', 'Be honest that the plan’s own medical charge rises too.'));
}

function claims() {
  return section('Claims', `
<div class="eyebrow rv">Medical claims in Malaysia</div>
<h2 class="rv d1">Families are using their cover <span class="hl">more than ever</span></h2>
<div class="glance">
  <div class="tile rv d2"><div class="k">Medical claims, 2025</div><div class="v num">RM9.4 bil</div><div class="s">paid by life insurers, more than half of all their payouts</div><div class="src">LIAM Annual Report 2025</div></div>
  <div class="tile dark rv d3"><div class="k">In two years</div><div class="v num" ${count(56, '+', '%')}>+56%</div><div class="s">rise in medical claims, 2021 to 2023</div><div class="src">LIAM, PIAM and MTA, Nov 2024</div></div>
  <div class="tile rv d4"><div class="k">Takaful benefits, 2025</div><div class="v num">RM10.6 bil</div><div class="s">paid by the takaful industry</div><div class="src">Malaysian Takaful Association, June 2026</div></div>
</div>
<p class="rv d5">Behind each ringgit is a family that didn’t have to pay that bill alone.</p>`, { night: true }, notes('Share a real claim story of your own here. Short and real.', 'Accuracy: RM10.6 bil is all takaful benefits, not just medical.'));
}

// ---------- A tale of two paths ----------

function twoPaths(m) {
  const lim = limitOf(m);
  if (m.monthly == null || !lim) return '';
  return section('Two paths', `
<div class="eyebrow rv">Two paths, ${rm(m.monthly)} a month</div>
<h2 class="rv d1">Same money, two choices. What happens when life doesn’t wait?</h2>
<div class="paths">
  <div class="path bank rv d2">
    <div class="path-k">Path A</div>
    <div class="path-t">${rm(m.monthly)}/month → Savings jar</div>
    <svg viewBox="0 0 200 160" aria-hidden="true">
      <defs><clipPath id="jarClip"><path d="M70 52 h60 q8 0 8 10 v68 q0 14 -14 14 h-48 q-14 0 -14 -14 v-68 q0 -10 8 -10z"/></clipPath></defs>
      <circle class="coin" cx="100" cy="10" r="6"/><circle class="coin c2" cx="92" cy="10" r="6"/><circle class="coin c3" cx="108" cy="10" r="6"/>
      <g clip-path="url(#jarClip)"><rect class="jar-fill" x="56" y="104" width="90" height="44"/><g class="jar-stack"><ellipse cx="86" cy="136" rx="12" ry="4"/><ellipse cx="86" cy="130" rx="12" ry="4"/><ellipse cx="86" cy="124" rx="12" ry="4"/><ellipse cx="112" cy="136" rx="12" ry="4"/><ellipse cx="112" cy="130" rx="12" ry="4"/></g></g>
      <path class="jar-glass" d="M70 52 h60 q8 0 8 10 v68 q0 14 -14 14 h-48 q-14 0 -14 -14 v-68 q0 -10 8 -10z"/><rect class="jar-lid" x="74" y="40" width="52" height="12" rx="4"/><path class="jar-shine" d="M76 64 v54"/><path class="jar-cap" d="M52 104 h96"/>
    </svg>
    <div class="cap">After one year: <b>${rm(m.annual)}</b> in the jar. Your protection is capped at what you saved.</div>
  </div>
  <div class="path fund rv d3">
    <div class="path-k">Path B</div>
    <div class="path-t">${rm(m.monthly)}/month → Tabarru’ fund</div>
    <svg viewBox="0 0 200 160" aria-hidden="true">
      <g class="net"><path class="net-line" d="M100 22 L100 80"/><path class="net-line" d="M141 39 L100 80"/><path class="net-line" d="M158 80 L100 80"/><path class="net-line" d="M141 121 L100 80"/><path class="net-line" d="M59 121 L100 80"/><path class="net-line" d="M42 80 L100 80"/><path class="net-line" d="M59 39 L100 80"/><path class="net-out" d="M100 80 L100 136"/></g>
      <g class="nodes">${[[100, 16, 0.2], [141, 33, 0.3], [158, 74, 0.4], [141, 115, 0.5], [100, 134, 0.6, 1], [59, 115, 0.7], [42, 74, 0.8], [59, 33, 0.9]].map(([x, y, dl, help]) => `<g class="node${help ? ' help' : ''}" style="animation-delay:${dl}s"><circle cx="${x}" cy="${y}" r="${help ? 5.5 : 4.5}"/><path d="M${x - 7} ${y + 14} q7 -12 14 0"/></g>`).join('')}</g>
      <circle class="fund-ring" cx="100" cy="80" r="17"/><circle class="fund-coin" cx="100" cy="80" r="17"/><path class="fund-mark" d="M104 72 q-4 -3 -8 0 q-4 4 4 7 q8 3 4 7 q-4 3 -8 0 M100 68 v24"/>
    </svg>
    <div class="cap">Your contribution joins a <b>Tabarru’ fund</b> shared by many families. When one family needs help, the fund pays, here with a medical card of <b>${esc(lim.long)}</b>.</div>
  </div>
</div>
<p class="fine rv d4">Illustration only. ${rm(m.monthly)} is your quoted monthly contribution. The medical card figure is from your quotation, subject to certificate terms.</p>`, {}, notes(`Ask: “After one year, Path A has about ${rm(m.annual)} saved. Feels good, right? Now let’s see what happens.”`));
}

function moment(m, ctx) {
  const bill = m.isChild ? 30000 : 60000;
  return section('The moment', `
<svg class="alarm-fig" viewBox="0 0 120 120" aria-hidden="true"><circle class="body" cx="60" cy="34" r="14"/><path class="body" d="M30 104 q30 -60 60 0"/><path class="body" d="M22 40 l-12 -8 M98 40 l12 -8 M60 6 v-6"/></svg>
<div class="eyebrow rv d1">${m.isChild ? 'One year later, a fever that won’t come down' : 'One year later, an accident on the way to work'}</div>
<svg class="ecg rv d1" viewBox="0 0 520 80" aria-hidden="true"><path d="M0 40 h150 l14 -26 l16 54 l16 -64 l14 36 h40 l12 -16 l12 16 h242"/></svg>
<h2 class="rv d2">The hospital needs</h2>
<div class="big-red num rv d3" ${count(bill)}>${rm(bill)}</div>
<p class="rv d4">Illustrative bill for a private hospital stay${m.isChild ? ' with tests and treatment' : ' with surgery'}.</p>`, { photo: ctx.photo(m.isChild ? 'child-ward1' : 'adult-ward1'), center: true }, notes('Pause after the number. Don’t add drama; let it land.'));
}

function pathA(m) {
  if (m.annual == null) return '';
  const bill = m.isChild ? 30000 : 60000;
  return section('Path A', `
<div class="eyebrow rv" style="color:var(--coral)">Path A: saved in the jar</div>
<h2 class="rv d1">${rm(m.annual)} saved. ${rm(bill)} needed. The gap has to come from somewhere.</h2>
<div class="steps">
  <div class="step rv d2"><div class="n">1</div><div><b>Use all the savings</b><span>${rm(m.annual)} gone in one admission. Still ${rm(bill - m.annual)} short.</span></div></div>
  <div class="step rv d3"><div class="n">2</div><div><b>Sell what you can</b><span>The car, the motorcycle, gold, often below their worth.</span></div></div>
  <div class="step rv d4"><div class="n">3</div><div><b>Ask family and friends</b><span>During the hardest week of your life.</span></div></div>
  <div class="step worst rv d5"><div class="n">4</div><div><b>Still short? Borrow</b><span>A personal loan or credit card, repaid with interest for years.</span></div></div>
</div>`, {}, notes('Ask: “Which of these steps would be hardest for you?” Listen. Don’t answer for them.'));
}

function pathB(m) {
  const lim = limitOf(m);
  if (!lim) return '';
  const cp = coPayLine(m);
  const who = m.isChild ? 'You' : esc(m.callName || 'You');
  return section('Path B', `
<div class="eyebrow rv">Path B: protected by takaful</div>
<h2 class="rv d1">${cp ? `${who} pay${m.isChild || !m.callName ? '' : 's'} ${cp.you}.` : 'The medical card steps in.'}</h2>
<div class="settled rv d2">
  <svg class="check" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="36"/><path d="M22 37 l10 10 l19 -21"/></svg>
  <div class="fig">The medical card pays the rest of the eligible bill.</div>
  <div>Cashless at PruBSN panel hospitals. No selling, no borrowing, no asking.</div>
</div>
<p class="fine rv d3">Illustration only. ${esc(m.medical.planName || 'The medical card')} pays eligible charges ${esc(lim.long)}${cp ? ` ${cp.fine}` : ''}, subject to exclusions, waiting periods and certificate terms.</p>`, {}, notes('Be exact: “eligible charges”, and mention the co-payment or deductible in the same breath. That honesty is what makes you different.'));
}

function doBoth(m) {
  if (m.monthly == null) return '';
  const total = Math.max(500, Math.ceil((m.monthly * 2.2) / 100) * 100);
  const save = total - m.monthly;
  const f = (m.monthly / total).toFixed(4);
  return section('Do both', `
<div class="eyebrow rv">The smart move</div>
<h2 class="rv d1">The best plan isn’t A or B. <span class="hl">It’s both.</span></h2>
<div class="donut-wrap">
  <div class="donut rv d2">
    <svg viewBox="0 0 220 220" aria-hidden="true"><circle class="track" cx="110" cy="110" r="88"/><circle class="seg" cx="110" cy="110" r="88" stroke="#0B2545" data-frac="${f}" data-start="0"/><circle class="seg" cx="110" cy="110" r="88" stroke="#D4A23A" data-frac="${(1 - f).toFixed(4)}" data-start="${f}"/></svg>
    <div class="donut-total"><span class="k">Per month</span><span class="v num" ${count(total)}>${rm(total)}</span></div>
  </div>
  <div class="split">
    <div class="split-row rv d3"><i style="background:#0B2545"></i><div><b class="num">${rm(m.monthly)} · Protection first</b><span>Example: this plan</span></div></div>
    <div class="split-row rv d4"><i style="background:#D4A23A"></i><div><b class="num">${rm(save)} · Emergency savings</b><span>About ${rm(Math.round((save * 12) / 100) * 100)} after a year, for co-payments and daily costs</span></div></div>
    <div class="split-row rv d5"><i style="background:#178D93"></i><div><b>Protect the big risks, save for the small ones</b><span>Takaful handles what savings can’t. Savings handle what takaful doesn’t.</span></div></div>
  </div>
</div>`, {}, notes(`You’re not against saving; you’re showing the order. ${rm(total)} is an example; adjust live to what they set aside.`));
}

function pyramid() {
  const tiers = [['g0', 't0', '20,410 580,410 528,336 72,336', 'lt', 381, 24, 'Protection'], ['g1', 't1', '76,330 524,330 472,256 128,256', 'lt', 301, 22, 'Emergency fund'], ['g2', 't2', '132,250 468,250 416,176 184,176', 'dk', 221, 20, 'Savings &amp; goals'], ['g3', 't3', '188,170 412,170 360,96 240,96', 'dk', 141, 19, 'Investment'], ['g4', 't4', '244,90 356,90 300,16', 'dk', 76, 15, 'Legacy']];
  return section('Financial pyramid', `
<div class="eyebrow rv">How to build family wealth</div>
<h2 class="rv d1">Every strong pyramid starts with <span class="hl">protection</span></h2>
<div class="pyr-wrap">
  <svg class="pyramid rv d2" viewBox="0 0 600 420" role="img" aria-label="Financial pyramid, from the base up: protection, emergency fund, savings and goals, investment, legacy">${tiers.map(([g, t, pts, c, y, fs, txt]) => `<g class="tier ${g}"><polygon class="${t}" points="${pts}"/><text class="${c}" x="300" y="${y}" font-size="${fs}">${txt}</text></g>`).join('')}</svg>
  <div class="split">
    <div class="split-row rv d3"><i style="background:#D4A23A"></i><div><b>Legacy</b><span>Hibah and wasiat, so wealth passes on smoothly</span></div></div>
    <div class="split-row rv d3"><i style="background:#A7D9DB"></i><div><b>Investment</b><span>Grow wealth once the base is safe</span></div></div>
    <div class="split-row rv d4"><i style="background:#5FB7BB"></i><div><b>Savings &amp; goals</b><span>A home, education, Hajj</span></div></div>
    <div class="split-row rv d4"><i style="background:#178D93"></i><div><b>Emergency fund</b><span>3 to 6 months of expenses</span></div></div>
    <div class="split-row rv d5"><i style="background:#0B2545"></i><div><b>Protection</b><span>Medical, life and critical illness cover</span></div></div>
  </div>
</div>
<div class="rule rv d6"><b>A simple guide:</b> keep protection to about 10% of monthly income, so it protects your lifestyle without taking it over.</div>`, {}, notes('If the base breaks (a big hospital bill), every layer above it falls with it, exactly like Path A.', 'The 10% line is a guiding principle, not a regulation. Say it as your advice.', 'Then: “Now I’d like to hear from you.”'));
}

// ---------- Your turn ----------

function aboutYou(m) {
  const ex = chips('ex', m.isChild ? 'What protection does the family have today? Choose any.' : 'What protection do you have today? Choose any.', [
    { val: 'Medical card', card: true }, { val: 'Company group medical', card: true }, 'Life cover', 'Critical illness', { val: 'None yet', alone: true },
  ], { multi: true, summary: 'Protection today' });
  const limitBox = `<div class="limit-box" id="limitBox" hidden>
  <label class="field" for="mcLimit"><span>Medical card limit (RM)</span><input id="mcLimit" type="text" inputmode="numeric" maxlength="9" placeholder="e.g. 100000"></label>
  ${chips('lt', 'Is that limit…', [{ val: 'Annual limit', label: 'Per year' }, { val: 'Lifetime limit', label: 'For life' }, 'Not sure'], { summary: 'Limit type' })}
</div>`;
  const second = m.isChild
    ? chips('hosp', 'If your child is admitted, which hospital would you choose?', ['Private hospital', 'Government hospital', 'Not sure yet'], { summary: 'Preferred hospital' })
      + chips('dep', 'Who else depends on the family income? Choose any.', ['Parents', 'Other children', { val: 'No one else', alone: true }], { multi: true, summary: 'Also depends on the income' })
    : chips('commute', 'How do you usually travel to work?', ['Car', 'Motorcycle', 'Public transport', { val: 'Mostly work from home', label: 'Mostly from home' }], { summary: 'Travels to work by' })
      + chips('dep', 'Who depends on your income? Choose any.', ['Parents', 'Spouse', 'Children', { val: 'No one yet', alone: true }], { multi: true, summary: 'Depends on the income' });
  return section('About you', `
<div class="eyebrow rv">Your turn · about you</div>
<h2 class="rv d1">Tell me a little about your situation</h2>
<div class="form-card rv d2">${ex}${limitBox}</div>
<div class="form-card rv d3">${second}</div>`, {}, notes('Let them tap the answers themselves. If they have a medical card, ask for its limit and whether it resets every year or is for life.', 'Health questions on the proposal must be answered accurately; PruBSN decides the underwriting.'));
}

function budgetBands(monthly) {
  const base = Math.max(100, Math.floor((monthly || 200) / 100) * 100);
  const lo = Math.max(100, base - 100);
  return [`RM${lo}–${lo + 100}`, `RM${lo + 100}–${lo + 200}`, `RM${lo + 200}–${lo + 300}`, `RM${lo + 300}+`];
}

function whatMatters(m, ctx) {
  const pri = m.isChild
    ? [['A big hospital bill', 'a big hospital bill'], ['Serious illness like cancer', 'serious illness like cancer'], ['Common childhood illness (fever, dengue, HFMD)', 'common childhood illness'], ['Medical costs rising every year', 'medical costs rising every year'], ['Savings for their future', 'savings for their future']]
    : [['A big hospital bill', 'a big hospital bill'], ['Cancer, heart attack or kidney failure', 'cancer, heart attack or kidney failure'], ['Accidents on the road', 'accidents on the road'], ['Medical costs rising every year', 'medical costs rising every year'], ['Leaving debt for my family', 'leaving debt for my family']];
  return section('What matters', `
<div class="eyebrow rv">Your turn · what matters most</div>
<h2 class="rv d1">Tap what matters to you</h2>
<div class="chip-group rv d2">${chips('pri', 'Biggest worries (choose any)', pri.map(([val, text]) => ({ val, text })), { multi: true, summary: 'Biggest worries' })}</div>
<div class="chip-group rv d3">${chips('bud', 'Monthly amount you can keep up long term', budgetBands(m.monthly), { summary: 'Monthly budget' })}</div>
<div class="said rv d4" data-said="Your choices show here and on the options screen.">Your choices show here and on the options screen.</div>
<p class="fine rv d5">Your answers are saved for ${esc(ctx.agent.short)} as you tap, so the plan can be prepared around them.</p>`, {}, notes('Hand them the phone or tablet and let them tap. Then ask: “If you were admitted tomorrow, where would the money come from?”'));
}

// ---------- Your plan ----------

function contributionDonut(m) {
  if (!m.breakdown.length || m.monthly == null) return '';
  const colours = { medical: '#0B2545', basic: '#178D93', riders: '#C2553F', wakalah: '#D4A23A' };
  const labels = m.product.breakdownLabels || {};
  let start = 0;
  const segs = m.breakdown.map((b) => {
    const frac = b.amount / m.monthly;
    const s = `<circle class="seg" cx="110" cy="110" r="88" stroke="${colours[b.key]}" data-frac="${frac.toFixed(4)}" data-start="${start.toFixed(4)}"/>`;
    start += frac;
    return s;
  }).join('');
  const lim = limitOf(m);
  const rows = m.breakdown.map((b, i) => {
    const l = labels[b.key] || { title: b.key, text: '' };
    let text = l.text;
    if (b.key === 'medical' && lim) text = `${l.text}: ${lim.short}`;
    if (b.key === 'basic' && m.protection.death) text = `${rm(m.protection.death)} on death or total permanent disability`;
    return `<div class="split-row rv d${3 + Math.floor(i / 2)}"><i style="background:${colours[b.key]}"></i><div><b class="num">${rm(b.amount)} · ${esc(l.title)}</b><span>${esc(text)}</span></div></div>`;
  }).join('');
  return section(`Your ${rm(m.monthly)}`, `
<div class="eyebrow rv">How your contribution works</div>
<h2 class="rv d1">${rm(m.monthly)} a month, <span class="hl">${m.breakdown.length} jobs</span></h2>
<div class="donut-wrap">
  <div class="donut rv d2"><svg viewBox="0 0 220 220" aria-hidden="true"><circle class="track" cx="110" cy="110" r="88"/>${segs}</svg><div class="donut-total"><span class="k">Total / month</span><span class="v num" ${count(m.monthly)}>${rm(m.monthly)}</span></div></div>
  <div class="split">${rows}</div>
</div>
<p class="fine rv d6">From your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ''}: ${rm(m.annual)} a year${m.term ? ` for ${m.term} years` : ''}${m.coverageToAge ? `, until age ${m.coverageToAge}` : ''}. Contributions go into your Individual Special Account (ISA), which pays the monthly Tabarru’ and charges.</p>`, {}, notes('Most of the contribution is usually the medical card. Point out what each part does.'));
}

function admitted(m, ctx) {
  const lim = limitOf(m);
  if (!lim) return '';
  const tail = m.medical.model === 'LIFETIME_MEDICAL_FUND'
    ? `Once the fund is used, eligible claims continue${m.medical.coShare ? ` with PruBSN paying ${m.medical.coShare.insurerPct}% and you ${m.medical.coShare.clientPct}%` : ''}.`
    : /no lifetime limit/i.test(m.medical.lifetimeLimitText || '') ? 'No lifetime limit.' : '';
  return section('Admitted', `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><rect class="soft" x="60" y="70" width="160" height="110" rx="6"/><path class="ln" d="M40 180 h200 M60 180 v-110 l80 -44 l80 44 v110 M120 180 v-40 h40 v40"/><path class="ln" d="M140 74 v32 M124 90 h32"/><circle class="gold pulse" cx="140" cy="90" r="5"/></svg>
<div class="step-k rv d1">${esc(m.medical.riderName || 'Medical card')} · Step 1 · ${m.isChild ? 'Your child is admitted' : 'You’re admitted'}</div>
<h2 class="rv d2">The moment ${m.isChild ? 'your child is' : 'you’re'} admitted, your <span class="hl">${esc(lim.short)}</span> starts working.</h2>
<p class="rv d3">${esc(tail)} Cashless at PruBSN panel hospitals.</p>`, { photo: ctx.photo('lobby'), center: true }, notes('Walk through this like a story: “Imagine you’re admitted next year.” Then go step by step.'));
}

function room(m, ctx) {
  if (!m.medical.roomRate) return '';
  const days = m.medical.roomDays ? `up to <span class="hl">${m.medical.roomDays} days</span> a year` : m.medical.roomUnlimited ? 'with <span class="hl">no limit on days</span>' : '';
  return section('The room', `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><rect class="soft" x="50" y="110" width="180" height="40" rx="8"/><path class="ln" d="M40 170 v-80 M40 130 h200 v40 M50 110 h180 a10 10 0 0 1 10 10 M60 110 a14 14 0 0 1 28 0"/><path class="ln" d="M220 40 v50 M206 54 h28"/><circle class="gold" cx="220" cy="40" r="6"/></svg>
<div class="kb-fig num rv d1" ${count(m.medical.roomRate)}>${rm(m.medical.roomRate)}<small>/day</small></div>
<div class="step-k rv d2">Step 2 · ${m.isChild ? 'The room' : 'Your room'}</div>
<h2 class="rv d3">Hospital room and board${days ? `, ${days}` : ''}.</h2>
<p class="rv d4">ICU and CCU are covered as charged. A more expensive room means paying the difference.</p>`, { photo: ctx.photo(m.isChild ? 'child-ward2' : 'adult-ward2'), center: true }, notes(`${rm(m.medical.roomRate)} a day is the room the plan pays for.`));
}

function treatment(m, ctx) {
  const pre = m.medical.preHospDays;
  const post = m.medical.postHospDays;
  const around = pre || post ? ` Tests and treatment${pre ? ` ${pre} days before` : ''}${pre && post ? ' and' : ''}${post ? ` ${post} days after` : ''} the stay, and day surgery.` : ' Day surgery too.';
  return section('Treatment', `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><ellipse class="soft" cx="140" cy="60" rx="70" ry="22"/><path class="ln" d="M140 10 v28 M70 60 a70 22 0 0 0 140 0 a70 22 0 0 0 -140 0"/><path class="ln" d="M20 150 h70 l12 -30 l16 56 l16 -70 l14 44 h112"/><circle class="gold pulse" cx="140" cy="60" r="7"/></svg>
<div class="step-k rv d1">Step 3 · Tests, treatment and surgery</div>
<h2 class="rv d2">Surgery and in-hospital treatment are covered <span class="hl">as charged</span>.</h2>
<p class="rv d3">Specialist visits and related hospital services too.${esc(around)}</p>`, { photo: ctx.photo('theatre'), center: true }, notes('“As charged” means the actual reasonable bill for eligible treatment, within the plan’s limit.'));
}

function clinic(m, ctx) {
  const amt = m.medical.childIllness || m.medical.dengue;
  if (!amt) return '';
  const what = m.medical.childIllness ? 'Dengue, HFMD and common childhood illnesses' : 'Dengue, influenza, measles, chikungunya or HFMD';
  return section('At the clinic', `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><circle class="soft" cx="140" cy="158" r="20"/><path class="ln" d="M130 146 V40 a10 10 0 0 1 20 0 V146 a20 20 0 1 1 -20 0z"/><path class="ln" d="M150 60 h12 M150 80 h12 M150 100 h12 M150 120 h12"/><path class="ln" d="M140 150 V92"/><circle class="gold pulse" cx="140" cy="158" r="10"/><path class="ln" d="M60 70 q-14 20 0 40 M78 78 q-8 12 0 24 M220 70 q14 20 0 40 M202 78 q8 12 0 24"/></svg>
<div class="kb-fig num rv d1" ${count(amt)}>${rm(amt)}<small>/illness</small></div>
<div class="step-k rv d2">Step 4 · Treated at the clinic</div>
<h2 class="rv d3">${what}, treated <span class="hl">without admission</span>.</h2>
<p class="rv d4">Outpatient treatment up to ${rm(amt)} per illness${m.medical.parentAllowance ? `, plus ${rm(m.medical.parentAllowance)} a day parent allowance` : ''}.</p>`, { night: true, photo: m.isChild ? ctx.photo('clinic') : null, center: true }, notes('Most people don’t know a medical card can pay for outpatient treatment of these illnesses.', 'Check the certificate for the per-year limit on how many illnesses this covers.'));
}

function serious(m, ctx) {
  const med = m.medical;
  if (!med.outpatientCancer && !med.extraLimit) return '';
  const h2 = med.extraLimit && med.annualLimit
    ? `Cancer, heart attack or kidney failure? Your yearly limit grows by <span class="hl">${rm(med.extraLimit)}</span>.`
    : `Cancer or kidney failure? Outpatient treatment up to <span class="hl">${rm(med.outpatientCancer)}</span>.`;
  const bar = med.extraLimit && med.annualLimit
    ? `<div class="limit-track rv d3" aria-hidden="true"><div class="limit-base" style="width:${(med.annualLimit / (med.annualLimit + med.extraLimit) * 100).toFixed(1)}%"></div><div class="limit-boost" style="width:${(med.extraLimit / (med.annualLimit + med.extraLimit) * 100).toFixed(1)}%"></div></div><div class="limit-labels rv d3"><span>${rm(med.annualLimit)} base</span><span>${rm(med.annualLimit + med.extraLimit)} a year</span></div>`
    : '';
  const extra = [
    med.extraLimit && med.outpatientCancer ? `Outpatient cancer treatment and kidney dialysis up to <b style="color:#FFFFFF">${rm(med.outpatientCancer)}</b> per lifetime.` : '',
    med.advancedTreatment ? `Advanced medical treatment up to ${rm(med.advancedTreatment)} per lifetime.` : '',
    med.secondOpinion ? `Second medical opinion up to ${rm(med.secondOpinion)} a year.` : '',
  ].filter(Boolean).join(' ');
  return section('If it’s serious', `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><path class="soft" d="M140 20 l70 26 v50 c0 46 -32 74 -70 88 c-38 -14 -70 -42 -70 -88 v-50z"/><path class="ln" d="M140 20 l70 26 v50 c0 46 -32 74 -70 88 c-38 -14 -70 -42 -70 -88 v-50z"/><path class="ln" d="M140 72 v56 M112 100 h56"/><circle class="gold pulse" cx="140" cy="100" r="6"/></svg>
<div class="step-k rv d1">Step 5 · If it’s serious</div>
<h2 class="rv d2">${h2}</h2>
${bar}
${extra ? `<p class="rv d4">${extra}</p>` : ''}`, { photo: ctx.photo('cancer'), center: true }, notes('Keep the tone calm and factual.', med.extraLimit ? 'The extra limit applies after a first diagnosis and has a waiting period; check the certificate wording.' : ''));
}

function alsoCovered(m) {
  const med = m.medical;
  const cells = [
    med.govHospital ? ['Government hospital', 'Daily cash allowance', `${rm(med.govHospital)} a day`] : null,
    med.accidentEmergency ? ['Accident emergency', 'Outpatient treatment after an accident', /as charged/i.test(med.accidentEmergency) ? 'As charged' : (med.accidentEmergency.match(/RM[\d,]+[^()]*/) || [''])[0].trim()] : null,
    med.homeNursing ? ['Home nursing care', 'After a hospital stay', /180 days/.test(med.homeNursing) ? 'Up to 180 days per lifetime' : 'Included'] : null,
    med.vaccination ? ['Vaccinations', 'Such as Hajj/Umrah and flu', `${rm(med.vaccination)} a year`] : null,
    med.lens ? ['Intraocular lens', 'For cataract surgery', `Up to ${rm(med.lens)} per lifetime`] : null,
    med.secondOpinion && !(med.outpatientCancer || med.extraLimit) ? ['Second opinion', 'From another specialist', `${rm(med.secondOpinion)} a year`] : null,
    med.worldwide ? ['Worldwide emergency', 'Medical assistance abroad', 'Included'] : null,
  ].filter((c) => c && c[2]).slice(0, 6);
  if (cells.length < 3) return '';
  return section('Also covered', `
<div class="eyebrow rv">Everything else it covers</div>
<h2 class="rv d1">Your medical card, in plain terms</h2>
<div class="cover-grid">${cells.map((c, i) => `<div class="cv rv d${2 + Math.floor(i / 2)}"><b>${esc(c[0])}</b><span>${esc(c[1])}</span><em>${esc(c[2])}</em></div>`).join('')}</div>
<p class="fine rv d5">${esc(med.planName || 'Medical card')}${med.coPay.label ? `, ${esc(med.coPay.label)}` : ''}, from your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ''}. Subject to waiting periods, exclusions and certificate terms.</p>`, {}, notes('Quick scene. Point to one or two items that fit them.'));
}

function howLimitWorks(m) {
  const med = m.medical;
  const cp = coPayLine(m);
  if (med.model === 'LIFETIME_MEDICAL_FUND' && med.lifetimeFund) {
    const share = med.coShare;
    return section('How the fund works', `
<div class="eyebrow rv">${esc(med.riderName || 'Medical card')} · how the fund works</div>
<h2 class="rv d1">A <span class="hl">${rm(med.lifetimeFund)}</span> medical fund, and no hard stop</h2>
<div class="limit-track rv d2" aria-hidden="true"><div class="limit-base" style="width:70%"></div><div class="limit-boost" style="width:30%"></div></div>
<div class="limit-labels rv d2"><span>${rm(med.lifetimeFund)} fund pays first</span><span>${share ? `then ${share.insurerPct}% / ${share.clientPct}%` : 'then shared'}</span></div>
<div class="split">
  <div class="split-row rv d3"><i style="background:#178D93"></i><div><b>The fund pays eligible bills first</b><span>Hospital stays, surgery and outpatient treatment covered by the plan draw from the ${rm(med.lifetimeFund)} fund.</span></div></div>
  ${share ? `<div class="split-row rv d4"><i style="background:#D4A23A"></i><div><b>After the fund is used, cover continues</b><span>PruBSN pays ${share.insurerPct}% and you pay ${share.clientPct}% of eligible claims, so a big illness doesn’t end the cover.</span></div></div>` : ''}
  ${cp ? `<div class="split-row rv d5"><i style="background:#C2553F"></i><div><b>${esc(med.coPay.label)}</b><span>You pay ${cp.you.replace(/<[^>]+>/g, '')} before the plan pays, as set out in the certificate.</span></div></div>` : ''}
</div>
<p class="fine rv d6">${esc(med.lifetimeLimitText || '')}. From your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ''}. Charges are not guaranteed and may change with notice.</p>`, {}, notes('Compare with what they told you about their current card.'));
  }
  if (!med.annualLimit) return '';
  const boosted = med.extraLimit ? med.annualLimit + med.extraLimit : null;
  const max = boosted || med.annualLimit;
  const bar = (v, lbl, gold) => `<div class="bar-col"><div class="bar-val num">${rmShort(v)}</div><div class="bar-pair"><div class="bar${gold ? ' gold' : ''}" style="height:${(v / max * 100).toFixed(1)}%"></div></div><div class="bar-age">${lbl}</div></div>`;
  const bars = boosted
    ? [bar(med.annualLimit, 'Year 1'), bar(med.annualLimit, 'Year 2'), bar(med.annualLimit, 'Year 3'), bar(med.annualLimit, 'Year 4'), bar(boosted, 'After diagnosis*', true), bar(boosted, 'Every year after', true)]
    : [1, 2, 3, 4, 5, 6].map((y) => bar(med.annualLimit, `Year ${y}`));
  return section('How the limit works', `
<div class="eyebrow rv">${esc(med.riderName || 'Medical card')} · how the limit works</div>
<h2 class="rv d1">${rm(med.annualLimit)} every year${/no lifetime limit/i.test(med.lifetimeLimitText || '') ? ', and <span class="hl">no lifetime limit</span>' : ''}</h2>
<div class="bars bars6 rv d2" aria-label="Annual limit renewing every year">${bars.join('')}</div>
<div class="split">
  <div class="split-row rv d3"><i style="background:#178D93"></i><div><b>Renews every certificate year</b><span>Use it this year and it’s back to ${rm(med.annualLimit)} next year.</span></div></div>
  ${cp ? `<div class="split-row rv d4"><i style="background:#D4A23A"></i><div><b>${esc(med.coPay.label)}</b><span>You pay ${cp.you.replace(/<[^>]+>/g, '')} per disability; some benefits are exempt, as listed in the certificate.</span></div></div>` : ''}
  <div class="split-row rv d5"><i style="background:#C2553F"></i><div><b>The plan’s medical charge is not guaranteed</b><span>It can rise with age and medical inflation, with written notice.</span></div></div>
</div>
${boosted ? `<p class="fine rv d6">*An extra ${rm(med.extraLimit)} a year applies after a first diagnosis of cancer, heart attack or kidney failure, after its waiting period. From your PruBSN quotation.</p>` : ''}`, {}, notes('A lifetime limit gets used up; an annual limit comes back every year.'));
}

function waiting(m) {
  const w = m.medical.waiting;
  if (!w.length) return '';
  const tidy = (s) => String(s || '').replace(/^after the effective date of the rider( or the date it is revived)?( for)?\s*/i, '').replace(/\s*\(if applicable\)\.?/gi, '').replace(/\.$/, '');
  const pts = [{ day: 'Day 1', b: 'Accidents', s: 'Covered from the start.' }];
  w.forEach((p) => {
    const text = tidy(p.description);
    if (pts.length < 4 && !pts.some((x) => x.day === `Day ${p.days}`)) pts.push({ day: `Day ${p.days}`, b: text.charAt(0).toUpperCase() + text.slice(1), s: '' });
  });
  return section('Waiting periods', `
<div class="eyebrow rv">Before your card kicks in</div>
<h2 class="rv d1">Waiting periods you should know about</h2>
<div class="timeline${pts.length === 4 ? ' tl4' : ''} rv d2"><div class="tl-line"></div><div class="tl-fill"></div><div class="tl-points">${pts.map((p) => `<div class="tl-pt"><div class="dot"></div><div class="day">${esc(p.day)}</div><b>${esc(p.b)}</b>${p.s ? `<span>${esc(p.s)}</span>` : ''}</div>`).join('')}</div></div>
<p class="fine rv d3">Counted from the certificate’s effective date. ${w.length > pts.length - 1 ? `Other waiting periods: ${w.slice(pts.length - 1).map((p) => `${p.days} days for ${tidy(p.description)}`).map(esc).join('; ')}. ` : ''}Pre-existing conditions are not covered. Full terms are in the certificate document.</p>`, {}, notes('The sooner the certificate starts, the sooner these clocks start. Say it as a fact, not pressure.'));
}

function account(m) {
  const pts = m.cash.points;
  if (pts && pts.length >= 3) {
    let px = pts[0], py = pts[0];
    pts.forEach((r) => { if (r[1] > px[1]) px = r; if (r[2] > py[2]) py = r; });
    return section('Your account', `
<div class="eyebrow rv">Non-guaranteed cash value</div>
<h2 class="rv d1">How the account could grow</h2>
<svg class="chart rv d2" id="growth" viewBox="0 0 640 300" role="img" aria-label="Cash value by certificate year, Scenario Y peaks about ${rm(py[2])}"></svg>
<div class="scen rv d3"><div><i style="background:var(--ink)"></i><span class="num">Scenario Y · up to about ${rm(py[2])}</span></div><div><i style="background:var(--teal)"></i><span class="num">Scenario X · up to about ${rm(px[1])}</span></div></div>
<p class="fine rv d4">Cash value from the quotation’s illustration table, by certificate year. Not guaranteed. ${m.protection.death ? `Death / TPD benefit from ${rm(m.protection.death)}.` : ''}</p>`, {}, notes('Be clear this is a protection plan first. The account keeps the cover running.'));
  }
  const { x, y } = m.cash.atEnd;
  if (x == null && y == null) return '';
  return section('Your account', `
<div class="eyebrow rv">Non-guaranteed cash value</div>
<h2 class="rv d1">What could be left in the account${m.coverageToAge ? ` at age ${m.coverageToAge}` : ''}</h2>
<div class="glance two">
  ${y != null ? `<div class="tile dark rv d2"><div class="k">Scenario Y</div><div class="v num" ${count(y)}>${rm(y)}</div><div class="s">Higher investment return, not guaranteed</div></div>` : ''}
  ${x != null ? `<div class="tile rv d3"><div class="k">Scenario X</div><div class="v num" ${count(x)}>${rm(x)}</div><div class="s">Lower investment return, not guaranteed</div></div>` : ''}
</div>
<p class="fine rv d4">From the quotation’s illustration. The account pays the monthly Tabarru’ and charges, which rise with age and medical inflation, so extra contributions may be needed later.${m.protection.death ? ` Death / TPD benefit: ${rm(m.protection.death)}.` : ''}</p>`, {}, notes('Be clear this is a protection plan first. The account is what keeps the cover running.'));
}

// ---------- Options (2-3 quotations) ----------

function options(models) {
  if (models.length < 2) return '';
  const first = models[0];
  const rowsDef = [
    ['Medical card', [
      ['Medical plan', (m) => m.medical.planName, 'text'],
      ['Medical limit', (m) => (m.medical.model === 'LIFETIME_MEDICAL_FUND' ? m.medical.lifetimeFund : m.medical.annualLimit), 'more', (m, v) => (m.medical.model === 'LIFETIME_MEDICAL_FUND' ? `${rm(v)} lifetime fund` : `${rm(v)} a year`)],
      ['Room & board', (m) => m.medical.roomRate, 'more', (m, v) => `${rm(v)}/day${m.medical.roomDays ? `, ${m.medical.roomDays} days a year` : m.medical.roomUnlimited ? ', unlimited days' : ''}`],
      ['Co-payment', (m) => m.medical.coPay.label || 'None', 'text'],
      ['Outpatient dengue & infectious disease', (m) => m.medical.dengue, 'more', (m, v) => `${rm(v)} per illness`],
      ['Government hospital cash', (m) => m.medical.govHospital, 'more', (m, v) => `${rm(v)}/day`],
    ]],
    ['Serious illness', [
      ['Extra yearly limit for cancer, heart attack or kidney failure', (m) => m.medical.extraLimit, 'more', (m, v) => `+${rm(v)}`],
      ['Outpatient cancer & dialysis', (m) => m.medical.outpatientCancer, 'more', (m, v) => `${rm(v)} per lifetime`],
      ['Advanced medical treatment', (m) => m.medical.advancedTreatment, 'more', (m, v) => `${rm(v)} per lifetime`],
      ['Second medical opinion', (m) => m.medical.secondOpinion, 'more', (m, v) => `${rm(v)} a year`],
    ]],
    ['Cost & long term', [
      ['Monthly contribution', (m) => m.monthly, 'cost', (m, v) => rm(v)],
      ['Death / TPD (basic plan)', (m) => m.protection.death, 'more', (m, v) => rm(v)],
      ['Covered until', (m) => m.coverageToAge, 'text', (m, v) => `Age ${v}`],
      ['Total contribution over the term', (m) => m.totalOverTerm, 'cost', (m, v) => rm(v)],
      ['Cash value at the end (Scenario Y, not guaranteed)', (m) => m.cash.atEnd.y, 'more', (m, v) => rm(v)],
    ]],
  ];
  const tag = (kind, base, v) => {
    if (v == null) return '';
    if (base == null) return '';
    if (kind === 'text') return String(v) === String(base) ? '' : ' <i class="tag up">Different</i>';
    if (v === base) return ' <i class="tag same">Same</i>';
    if (kind === 'cost') return v > base ? ' <i class="tag down">Costs more</i>' : ' <i class="tag up">Costs less</i>';
    return v > base ? ' <i class="tag up">Higher</i>' : ' <i class="tag down">Lower</i>';
  };
  const body = rowsDef.map(([grp, rows]) => {
    const kept = rows.filter(([, get]) => models.some((m) => get(m) != null));
    if (!kept.length) return '';
    return `<tr class="grp"><td colspan="${models.length + 1}">${esc(grp)}</td></tr>${kept.map(([label, get, kind, show]) => {
      const base = get(first);
      return `<tr><td>${esc(label)}</td>${models.map((m, i) => {
        const v = get(m);
        // "Not listed" rather than "Not included": a blank here can also be a
        // figure the PDF prints in a merged table cell the parser couldn't place.
        if (v == null) return '<td class="none">Not listed</td>';
        const shown = show ? show(m, v) : v;
        return `<td>${esc(shown)}${i ? tag(kind, base, v) : ''}</td>`;
      }).join('')}</tr>`;
    }).join('')}`;
  }).join('');
  const diffs = models.slice(1).map((m, i) => {
    const more = m.monthly != null && first.monthly != null ? m.monthly - first.monthly : null;
    return more == null ? '' : `Option ${i + 2} is ${rm(Math.abs(more))} ${more >= 0 ? 'more' : 'less'} a month than Option 1${m.totalOverTerm && first.totalOverTerm ? ` (${rm(Math.abs(m.totalOverTerm - first.totalOverTerm))} ${m.totalOverTerm >= first.totalOverTerm ? 'more' : 'less'} over the term)` : ''}.`;
  }).filter(Boolean).join(' ');
  return section('Your options', `
<div class="eyebrow rv">Your options</div>
<h2 class="rv d1">${models.length} options, <span class="hl">side by side</span></h2>
<div class="said rv d1" data-said="Tell me what matters most and I’ll show which option fits.">Tell me what matters most and I’ll show which option fits.</div>
<div class="cmp-wrap rv d2"><table class="cmp">
  <thead><tr><th scope="col">Benefit</th>${models.map((m, i) => `<th scope="col" class="${i ? 'o2' : 'o1'}">Option ${i + 1}<span>${rm(m.monthly)} / month</span></th>`).join('')}</tr></thead>
  <tbody>${body}</tbody>
</table></div>
${diffs ? `<p class="rv d3"><b>The trade-off:</b> ${esc(diffs)} A plan you can keep paying beats a bigger plan that lapses.</p>` : ''}
<div class="chip-group rv d4">${chips('opt', 'Which option feels right for you?', [...models.map((m, i) => ({ val: `Option ${i + 1} · ${m.medical.planName || m.productName} · ${rm(m.monthly)}`, label: `Option ${i + 1} · ${rm(m.monthly)}` })), 'Still deciding'], { summary: 'Preferred option' })}</div>
<p class="fine rv d5">From your PruBSN quotations. Contributions, Tabarru’ and medical charges are not guaranteed. Tags compare each option with Option 1. “Not listed” means the figure isn’t in that quotation’s summary; check the full quotation.</p>`, {}, notes('Don’t read every row. Point to the coloured tags: green is more, red is less or costs more.', 'Link back to their worries and budget. Be honest about the trade-off.'));
}

function glance(m) {
  const lim = limitOf(m);
  const tiles = [
    m.monthly != null ? `<div class="k">Monthly</div><div class="v num" ${count(m.monthly)}>${rm(m.monthly)}</div><div class="s">Contribution today</div>` : null,
    m.coverageToAge ? `<div class="k">Covered until</div><div class="v num">Age ${m.coverageToAge}</div><div class="s">${m.term ? `${m.term}-year term` : ''}</div>` : null,
    lim ? `<div class="k">Medical ${m.medical.model === 'LIFETIME_MEDICAL_FUND' ? 'fund' : 'limit'}</div><div class="v num" ${count(lim.amount)}>${rm(lim.amount)}</div><div class="s">${m.medical.model === 'LIFETIME_MEDICAL_FUND' ? 'Lifetime, then cost-sharing' : 'A year'}</div>` : null,
    m.medical.roomRate ? `<div class="k">Room & board</div><div class="v num" ${count(m.medical.roomRate)}>${rm(m.medical.roomRate)}</div><div class="s">A day</div>` : null,
    m.protection.death ? `<div class="k">Death / TPD</div><div class="v num" ${count(m.protection.death)}>${rm(m.protection.death)}</div><div class="s">Basic plan</div>` : null,
    m.cash.atEnd.y != null ? `<div class="k">Cash value at the end</div><div class="v num">${rm(m.cash.atEnd.y)}</div><div class="s">Scenario Y, not guaranteed</div>` : null,
  ].filter(Boolean);
  if (tiles.length < 3) return '';
  return section('At a glance', `
<div class="eyebrow rv">The full picture</div>
<h2 class="rv d1">${m.term ? `${m.term} years, at a glance` : 'Your plan, at a glance'}</h2>
<div class="glance">${tiles.map((t, i) => `<div class="tile${i === 2 ? ' dark' : ''} rv d${2 + i}">${t}</div>`).join('')}</div>
${m.totalOverTerm ? `<p class="fine rv d8">Total contribution${m.term ? ` over ${m.term} years` : ''}: ${rm(m.totalOverTerm)} at today’s rate. The medical charge is not guaranteed and may rise. From your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ''}.</p>` : ''}`, {});
}

function nextSteps(m, ctx) {
  const a = ctx.agent;
  return section('Next steps', `
<div class="done rv"><svg viewBox="0 0 44 44" aria-hidden="true"><path d="M10 23 l8 8 l16 -18"/></svg></div>
<h2 class="rv d1">Let’s protect what you’ve worked for, before life asks you to.</h2>
<div class="next-list">
  <div class="rv d2">Choose the option that fits your answers and budget</div>
  <div class="rv d3">Fill in the proposal with complete, accurate health answers</div>
  <div class="rv d4">PruBSN reviews it, then the certificate is issued</div>
  <div class="rv d5">First contribution, and your waiting periods start</div>
</div>
<div class="send-box rv d5">
  <div class="send-summary" id="sendSummary">No answers yet. Tap your answers on the earlier screens.</div>
  <div class="send-actions">
    <button class="copy-btn" type="button" id="copyBtn" hidden>Copy answers</button>
  </div>
  <div class="send-status" id="sendStatus" role="status" aria-live="polite"></div>
</div>
${a.formUrl ? `<a class="form-link rv d6" href="${esc(a.formUrl)}" target="_blank" rel="noopener">Ready? Fill in your application form <span aria-hidden="true">→</span></a>` : ''}
<div class="agent rv d6"><div class="av">${esc((a.short || a.name || '?').charAt(0))}</div><div><b>${esc(a.name)}</b><span>${a.code ? `Takaful Agent ${esc(a.code)} · ` : ''}${esc(a.agency)}</span></div></div>
<div class="tagline rv d7">${esc(a.tagline)}</div>`, { center: true }, notes('Read the summary back to them. Their answers save by themselves as they tap, to Presentation answers in your portal (and their VB name).', 'Close without pressure: “If you want to think it over, I understand. Shall I follow up on Monday?”'));
}

function sources(models) {
  const pages = [...new Map(models.map((m) => [m.product.productPage, m])).values()];
  return section('Sources', `
<div class="eyebrow rv">Sources</div>
<h2 class="rv d1">Where the numbers come from</h2>
<div class="src-list rv d2">
  <a href="https://www.thestar.com.my/news/nation/2024/04/22/less-than-half-of-malaysians-are-insured-as-we-become-an-ageing-society" target="_blank" rel="noopener">~45% insured, LIAM CEO<span>The Star, 22 Apr 2024</span></a>
  <a href="https://www.theborneopost.com/2022/10/24/one-in-three-working-malaysians-still-not-personally-protected/" target="_blank" rel="noopener">30% of working 25–40s unprotected, Zurich survey<span>Borneo Post, 24 Oct 2022</span></a>
  <a href="https://www.thestar.com.my/business/business-news/2026/06/10/takaful-industry-grows-473-in-2025-gross-contributions-reach-rm1638bil-in-2025" target="_blank" rel="noopener">Takaful penetration 19.6%, RM10.6 bil benefits, MTA<span>The Star, 10 Jun 2026</span></a>
  <a href="https://theedgemalaysia.com/article/cover-story-closing-insurance-family-takaful-protection-gap" target="_blank" rel="noopener">UKM–LIAM underinsurance study (94–98%, RM100k–150k)<span>The Edge Malaysia</span></a>
  <a href="https://www.thestar.com.my/news/nation/2025/10/30/interactive-malaysia039s-medical-inflation-to-rise-to-16-in-2026-says-aon" target="_blank" rel="noopener">Malaysia 16%, Asia Pacific 11.3%, Aon 2026<span>The Star, 30 Oct 2025</span></a>
  <a href="https://www.wtwco.com/en-gb/news/2025/11/double-digit-healthcare-cost-increases-projected-to-persist-into-2026-and-beyond" target="_blank" rel="noopener">Global 10.3%, WTW Global Medical Trends 2026<span>WTW, Nov 2025</span></a>
  <a href="https://www.freemalaysiatoday.com/category/nation/2026/04/14/medical-claims-hit-rm9-4bil-up-5-3-in-2025" target="_blank" rel="noopener">RM9.4 bil medical claims 2025; +56% 2021–2023<span>FMT, 14 Apr 2026</span></a>
  ${pages.map((m) => `<a href="${esc(m.product.productPage)}" target="_blank" rel="noopener">${esc(m.product.name)} product page<span>Plan figures: your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ''}${m.version ? `, version ${esc(m.version)}` : ''}</span></a>`).join('')}
</div>`, {}, notes('Keep this for questions. Always check the issued certificate for final terms.'));
}

/** The scene order. Each entry gets (primaryModel, ctx) and may return ''. */
const SCENES = [
  intro, cover, agenda,
  protectedStat, underinsured, inflation, yourMedicalCost, claims,
  twoPaths, moment, pathA, pathB, doBoth, pyramid,
  aboutYou, whatMatters,
  contributionDonut, admitted, room, treatment, clinic, serious, alsoCovered, howLimitWorks, waiting, account,
  (m, ctx) => options(ctx.models),
  glance, nextSteps,
  (m, ctx) => sources(ctx.models),
];

module.exports = { SCENES, esc, rm, limitOf, budgetBands };
