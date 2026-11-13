/**
 * storyStyles.js
 *
 * The animated story deck's stylesheet, as a string the renderer inlines
 * into each generated presentation (a published deck is one standalone
 * HTML file - no external stylesheet to fetch). Lifted from the
 * hand-built client decks (prubsn-presentations) so generated decks look
 * and move exactly the same.
 */

'use strict';

const STORY_CSS = `
/* Layout: one full-screen scene at a time, tap or swipe to advance, illustrated SVG motion in each scene. Same committed look as the AnugerahMax story deck (single light "dawn" world with night scenes). */
:root {
  --ink: #0B2545;
  --ink-soft: #5A6B85;
  --teal: #178D93;
  --teal-bright: #4FD1D9;
  --gold: #D4A23A;
  --coral: #C2553F;
  --paper: #FFFFFF;
  --night: #0B2545;
  --night-2: #16345E;
  --mist: #C9D6E8;
  --mist-2: #8FA3BF;
  --dawn: linear-gradient(165deg, #F6C9D6 0%, #F2D3E2 18%, #E7D7EC 38%, #D6E1F0 60%, #C3E7F3 82%, #BEEAF4 100%);
  --serif: "Newsreader", Georgia, "Times New Roman", serif;
  --sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --ease: cubic-bezier(.22, 1, .36, 1);
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: #E7D7EC; color: var(--ink); font-family: var(--sans); overflow: hidden; -webkit-tap-highlight-color: transparent; }

.deck { position: relative; height: 100%; background: var(--dawn); overflow: hidden; }
.slide {
  position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center;
  padding-block: 64px 96px;
  padding-left: max(24px, env(safe-area-inset-left, 0px)); padding-right: max(24px, env(safe-area-inset-right, 0px));
  opacity: 0; visibility: hidden; transform: translateX(40px);
  transition: opacity .6s var(--ease), transform .6s var(--ease), visibility 0s .6s;
  overflow-y: auto;
}
.slide.is-active { opacity: 1; visibility: visible; transform: none; transition: opacity .6s var(--ease), transform .6s var(--ease), visibility 0s; }
.slide.is-past { transform: translateX(-40px); }
.slide.night { background: radial-gradient(120% 90% at 50% 0%, var(--night-2) 0%, var(--night) 70%); color: #fff; }
.inner { width: min(760px, 100%); margin-inline: auto; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.center { text-align: center; align-items: center; }

.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--teal); }
.night .eyebrow { color: var(--teal-bright); }
h1, h2 { font-family: var(--serif); font-weight: 600; margin: 0; text-wrap: balance; line-height: 1.12; }
h1 { font-size: clamp(32px, 6vw, 56px); }
h2 { font-size: clamp(26px, 4.6vw, 42px); }
.hl { color: var(--teal); }
.night .hl { color: var(--teal-bright); }
p { margin: 0; font-size: clamp(16px, 2vw, 19px); line-height: 1.55; color: var(--ink-soft); max-width: 60ch; }
.night p { color: var(--mist); }
.fine { font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
.night .fine { color: var(--mist-2); }
.num { font-variant-numeric: tabular-nums; }

.rv { opacity: 1; transform: none; }
@media (prefers-reduced-motion: no-preference) {
  .slide .rv { opacity: 0; transform: translateY(22px); }
  .slide.is-active .rv { opacity: 1; transform: none; transition: opacity .8s var(--ease), transform .8s var(--ease); }
  .slide.is-active .d1 { transition-delay: .15s; } .slide.is-active .d2 { transition-delay: .3s; }
  .slide.is-active .d3 { transition-delay: .45s; } .slide.is-active .d4 { transition-delay: .6s; }
  .slide.is-active .d5 { transition-delay: .75s; } .slide.is-active .d6 { transition-delay: .9s; }
  .slide.is-active .d7 { transition-delay: 1.05s; } .slide.is-active .d8 { transition-delay: 1.2s; }
}

/* Intro */
.brand { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.brand-mark { width: 84px; height: 84px; }
.brand-mark .ring { fill: none; stroke: var(--teal); stroke-width: 3; }
.brand-mark .leaf { fill: var(--gold); transform-origin: 50% 60%; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .brand-mark .ring { animation: draw 1.6s var(--ease) both; }
  .is-active .brand-mark .leaf { animation: pop 1s var(--ease) .9s both; }
}
.tagline { font-family: var(--serif); font-style: italic; font-size: clamp(24px, 4vw, 32px); color: var(--teal); }
.tap-hint { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #7C88A0; }
@media (prefers-reduced-motion: no-preference) { .is-active .tap-hint { animation: nudge 1.8s ease-in-out 2s infinite; } }

/* Cover */
.badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,.7); font-size: 13px; font-weight: 600; color: #7A5F0E; }
.agent-line { font-size: 14px; color: var(--ink-soft); }
.bump { width: 150px; height: auto; }
.bump .ln { fill: none; stroke: var(--teal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.bump .heart { fill: var(--coral); transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .bump .ln { animation: draw 2s var(--ease) both; }
  .is-active .bump .heart { animation: pop .8s var(--ease) 1.2s both, beat 1.4s ease-in-out 2s infinite; }
}

/* Agenda */
.agenda { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ag { background: var(--paper); border-radius: 14px; padding: 16px; display: flex; gap: 12px; align-items: flex-start; box-shadow: 0 6px 18px rgba(11,37,69,.06); min-width: 0; }
.ag .n { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 14px; background: #E3F4F5; color: var(--teal); }
.ag b { display: block; font-size: 15.5px; }
.ag span { font-size: 13.5px; color: var(--ink-soft); }
.promise { background: var(--night); color: #fff; border-radius: 16px; padding: 16px 18px; font-size: 15.5px; line-height: 1.5; }
.promise b { color: var(--teal-bright); }

/* People grid */
.people { width: min(520px, 100%); height: auto; }
.people .p { fill: rgba(255,255,255,.18); transform-box: fill-box; transform-origin: center bottom; }
.people .p.on { fill: var(--teal-bright); }
@media (prefers-reduced-motion: no-preference) { .is-active .people .p { animation: pop .6s var(--ease) both; } }
.kb-fig { font-family: var(--serif); font-size: clamp(48px, 10vw, 88px); font-weight: 700; color: var(--teal-bright); line-height: 1; }
.kb-fig small { font-size: .35em; color: #CFE0EE; font-weight: 600; }

/* Tiles */
.glance { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.glance.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.tile { background: var(--paper); border-radius: 14px; padding: 16px; min-width: 0; color: var(--ink); text-align: left; }
.tile.dark { background: var(--teal); color: #fff; }
.tile.navy { background: var(--night); color: #fff; }
.tile .k { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
.tile.dark .k, .tile.navy .k { color: #CFF1F2; }
.tile .v { font-family: var(--serif); font-size: clamp(24px, 3.6vw, 34px); font-weight: 700; margin-top: 4px; line-height: 1.1; }
.tile .s { font-size: 13px; line-height: 1.45; color: var(--ink-soft); margin-top: 4px; }
.tile.dark .s, .tile.navy .s { color: #CFF1F2; }
.tile .src { font-size: 11.5px; color: var(--mist-2); margin-top: 8px; }
.tile.dark .src { color: #BFE7E9; }

/* Underinsured bar */
.under { display: flex; flex-direction: column; gap: 8px; }
.under-track { height: 22px; border-radius: 999px; background: rgba(11,37,69,.1); overflow: hidden; display: flex; }
.under-fill { width: 96%; background: var(--coral); transform-origin: left; border-radius: 999px; }
.under-labels { display: flex; justify-content: space-between; font-size: 13px; color: var(--ink-soft); gap: 12px; }
@media (prefers-reduced-motion: no-preference) {
  .slide .under-fill { transform: scaleX(0); }
  .is-active .under-fill { transform: scaleX(1); transition: transform 1.6s var(--ease) .6s; }
}

/* Horizontal bars */
.hbars { display: flex; flex-direction: column; gap: 14px; }
.hrow { display: grid; grid-template-columns: 120px minmax(0, 1fr) 64px; gap: 12px; align-items: center; }
.hrow .lbl { font-size: 14.5px; font-weight: 600; }
.hrow .val { font-family: var(--serif); font-size: 24px; font-weight: 700; text-align: right; }
.htrack { height: 34px; }
.hbar { height: 100%; border-radius: 4px 10px 10px 4px; background: var(--teal); transform-origin: left; }
.hbar.hi { background: var(--coral); }
.hbar.lo { background: #9ED3D6; }
@media (prefers-reduced-motion: no-preference) {
  .slide .hbar { transform: scaleX(0); }
  .is-active .hbar { transform: scaleX(1); transition: transform 1.3s var(--ease); }
  .is-active .hrow:nth-child(2) .hbar { transition-delay: .25s; }
  .is-active .hrow:nth-child(3) .hbar { transition-delay: .5s; }
}

/* Vertical bars */
.bars { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; align-items: end; height: 240px; margin-top: 8px; }
.bar-col { display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; justify-content: flex-end; min-width: 0; }
.bar-pair { display: flex; align-items: flex-end; height: 100%; width: 100%; justify-content: center; }
.bar { width: 58%; border-radius: 8px 8px 3px 3px; background: var(--teal); transform-origin: bottom; }
.bar.hi { background: var(--coral); }
.bar-val { font-size: 12px; font-weight: 700; }
.bar-age { font-size: 12px; color: var(--ink-soft); }
@media (prefers-reduced-motion: no-preference) {
  .slide .bar { transform: scaleY(0); }
  .is-active .bar { transform: scaleY(1); transition: transform 1.2s var(--ease); }
}

/* Cover list */
.cover-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.cv { background: var(--paper); border-radius: 12px; padding: 14px; min-width: 0; }
.cv b { display: block; font-size: 14.5px; }
.cv span { font-size: 13px; color: var(--ink-soft); }
.cv em { font-style: normal; display: block; font-weight: 700; color: var(--teal); margin-top: 4px; font-size: 14px; }
.cv.alert { background: var(--night); color: #fff; }
.cv.alert span { color: var(--mist); }
.cv.alert em { color: var(--teal-bright); }
.cv .vs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.cv .vs i { font-style: normal; font-size: 12.5px; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
.cv .vs .sup { background: #E3F4F5; color: #0F6F74; }
.cv .vs .ess { background: #FBEDE9; color: #9A3F2D; }

/* Two paths */
.paths { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.path { border-radius: 16px; padding: 18px 16px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; min-width: 0; }
.path.bank { background: var(--paper); box-shadow: 0 8px 24px rgba(11,37,69,.08); }
.path.fund { background: var(--night); color: #fff; }
.path-k { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); }
.fund .path-k { color: var(--mist-2); }
.path-t { font-weight: 700; font-size: 15px; }
.path svg { width: 100%; max-width: 220px; height: auto; }
.path .cap { font-size: 13px; line-height: 1.45; color: var(--ink-soft); }
.fund .cap { color: var(--mist); }
.coin { fill: var(--gold); }
@media (prefers-reduced-motion: no-preference) {
  .is-active .coin { animation: coinFall 2.4s var(--ease) infinite; }
  .is-active .coin.c2 { animation-delay: .8s; } .is-active .coin.c3 { animation-delay: 1.6s; }
  .is-active .breathe { animation: breathe 3s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
}

/* The moment */
.ecg { width: 100%; max-width: 520px; height: auto; }
.ecg path { fill: none; stroke: var(--teal-bright); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.alarm-fig { width: 120px; height: auto; }
.alarm-fig .body { fill: none; stroke: #F2A65A; stroke-width: 4; stroke-linecap: round; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .ecg path { animation: draw 2.4s linear both; }
  .is-active .alarm-fig { animation: startle .5s ease-in-out 1s 3; }
}
.big-red { font-family: var(--serif); font-size: clamp(44px, 9vw, 84px); font-weight: 700; color: #F2A65A; line-height: 1; }

/* Steps */
.steps { display: flex; flex-direction: column; gap: 10px; }
.step { display: flex; gap: 14px; align-items: flex-start; background: var(--paper); border-radius: 14px; padding: 14px 16px; box-shadow: 0 6px 18px rgba(11,37,69,.06); }
.step.worst { background: var(--coral); color: #fff; }
.step .n { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 14px; background: #FBEDE9; color: var(--coral); }
.step.worst .n { background: rgba(255,255,255,.2); color: #fff; }
.step b { display: block; font-size: 15.5px; }
.step span { font-size: 14px; color: var(--ink-soft); }
.step.worst span { color: #FBE3DD; }
.settled { background: var(--teal); color: #fff; border-radius: 18px; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.settled .check { width: 72px; height: 72px; }
.settled .check circle { fill: rgba(255,255,255,.18); }
.settled .check path { fill: none; stroke: #fff; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: no-preference) { .is-active .settled .check path { animation: draw 1s var(--ease) .6s both; } }
.settled .fig { font-family: var(--serif); font-size: clamp(24px, 4vw, 32px); font-weight: 600; }

/* Donut */
.donut-wrap { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 24px; align-items: center; }
.donut { position: relative; width: 100%; max-width: 220px; aspect-ratio: 1; }
.donut svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.donut circle { fill: none; stroke-width: 22; }
.donut .track { stroke: rgba(11,37,69,.08); }
.donut-total { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.donut-total .k { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }
.donut-total .v { font-family: var(--serif); font-size: 38px; font-weight: 700; }
.split { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.split-row { background: var(--paper); border-radius: 12px; padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start; }
.split-row i { flex: none; width: 12px; height: 12px; border-radius: 3px; margin-top: 4px; }
.split-row b { display: block; }
.split-row span { font-size: 13.5px; color: var(--ink-soft); }

/* Pyramid */
.pyr-wrap { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; align-items: center; }
.pyramid { width: 100%; height: auto; }
.pyramid .tier { transform-box: fill-box; transform-origin: center bottom; }
.pyramid .t0 { fill: var(--night); }
.pyramid .t1 { fill: var(--teal); }
.pyramid .t2 { fill: #5FB7BB; }
.pyramid .t3 { fill: #A7D9DB; }
.pyramid .t4 { fill: var(--gold); }
.pyramid text { font-family: var(--sans); font-weight: 700; text-anchor: middle; }
.pyramid .lt { fill: #FFFFFF; }
.pyramid .dk { fill: var(--ink); }
@media (prefers-reduced-motion: no-preference) {
  .is-active .pyramid .tier { animation: rise .8s var(--ease) both; }
  .is-active .pyramid .g1 { animation-delay: .35s; } .is-active .pyramid .g2 { animation-delay: .7s; }
  .is-active .pyramid .g3 { animation-delay: 1.05s; } .is-active .pyramid .g4 { animation-delay: 1.4s; }
}
.rule { background: var(--night); color: #fff; border-radius: 12px; padding: 12px 14px; font-size: 14px; line-height: 1.5; }
.rule b { color: var(--teal-bright); }

/* Questions and chips */
.qs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.q { background: var(--paper); border-radius: 14px; padding: 14px 16px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.q .qk { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--teal); font-weight: 700; }
.q b { font-size: 15px; line-height: 1.4; }
.q span { font-size: 13px; color: var(--ink-soft); line-height: 1.45; }
.chip-group { display: flex; flex-direction: column; gap: 8px; }
.chip-label { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; color: var(--ink-soft); }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { font: 600 14px var(--sans); color: var(--ink); background: var(--paper); border: 2px solid transparent; border-radius: 999px; padding: 10px 16px; cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--night); color: #fff; border-color: var(--teal-bright); }
.chip:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
.said { background: rgba(255,255,255,.75); border-radius: 12px; padding: 12px 14px; font-size: 14px; color: var(--ink); line-height: 1.5; }
.said b { color: var(--teal); }

/* Options */
.options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.opt { background: var(--paper); border-radius: 14px; padding: 16px 14px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.opt.rec { background: var(--night); color: #fff; box-shadow: 0 0 0 3px var(--teal); }
.opt .k { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
.opt.rec .k { color: var(--teal-bright); }
.opt .nm { font-weight: 700; font-size: 14px; }
.opt .v { font-family: var(--serif); font-size: 26px; font-weight: 700; }
.opt .v small { font-size: 13px; font-family: var(--sans); font-weight: 500; }
.opt .meta { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; }
.opt.rec .meta { color: var(--mist); }

/* Timeline */
.timeline { position: relative; margin-top: 20px; padding-top: 36px; }
.tl-line { position: absolute; top: 46px; left: 6px; right: 6px; height: 4px; border-radius: 4px; background: rgba(11,37,69,.12); }
.tl-fill { position: absolute; top: 46px; left: 6px; height: 4px; border-radius: 4px; background: var(--teal); width: calc(100% - 12px); transform-origin: left; }
@media (prefers-reduced-motion: no-preference) {
  .slide .tl-fill { transform: scaleX(0); }
  .is-active .tl-fill { transform: scaleX(1); transition: transform 2.4s var(--ease) .3s; }
}
.tl-points { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.tl-pt { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tl-pt .dot { width: 24px; height: 24px; border-radius: 50%; background: var(--teal); border: 5px solid #fff; box-shadow: 0 0 0 2px var(--teal); }
.tl-pt .dot.warn { background: var(--coral); box-shadow: 0 0 0 2px var(--coral); }
.tl-pt .day { font-family: var(--serif); font-size: 24px; font-weight: 700; }
.tl-pt b { font-size: 14.5px; }
.tl-pt span { font-size: 13px; color: var(--ink-soft); }

/* Close */
.done { width: 96px; height: 96px; border-radius: 50%; background: var(--teal); display: grid; place-items: center; }
.done svg { width: 44px; height: 44px; }
.done path { fill: none; stroke: #fff; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .done { animation: ring 2.4s ease-in-out 1.2s infinite; }
  .is-active .done path { animation: draw .9s var(--ease) .3s both; }
}
.agent { display: flex; gap: 12px; align-items: center; background: rgba(255,255,255,.75); border-radius: 14px; padding: 12px 16px; text-align: left; }
.agent .av { width: 44px; height: 44px; border-radius: 12px; background: var(--night); color: var(--gold); display: grid; place-items: center; font-family: var(--serif); font-weight: 700; font-size: 18px; flex: none; }
.agent b { display: block; font-size: 14.5px; }
.agent span { font-size: 12.5px; color: var(--ink-soft); }
.next-list { display: flex; flex-direction: column; gap: 8px; text-align: left; width: 100%; }
.next-list div { background: rgba(255,255,255,.75); border-radius: 12px; padding: 10px 14px; font-size: 14px; color: var(--ink); }

/* Sources */
.src-list { display: flex; flex-direction: column; gap: 8px; }
.src-list a { display: block; background: var(--paper); border-radius: 10px; padding: 10px 14px; font-size: 13.5px; color: var(--ink); text-decoration: none; line-height: 1.45; }
.src-list a span { display: block; color: var(--ink-soft); font-size: 12px; }
.src-list a:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }


/* Congenital conditions */
.cond-head { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 18px; align-items: center; }
.cond-art { width: 120px; height: auto; }
.cond-art .ln { fill: none; stroke: var(--teal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.cond-art .soft { fill: rgba(23,141,147,.10); }
.cond-art .gold { fill: var(--gold); transform-box: fill-box; transform-origin: center; }
.cond-title { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cond-big { display: flex; align-items: center; gap: 14px; font-family: var(--serif); font-size: clamp(22px, 3.6vw, 32px); font-weight: 600; line-height: 1.15; text-wrap: balance; }
.cond-big b { color: var(--teal); font-weight: 600; }
.kb27 { font-size: clamp(64px, 11vw, 96px); font-weight: 700; color: var(--coral); line-height: 1; flex: none; }
.cond { display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,.6); border-radius: 14px; padding: 14px; }
.cond-g { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 10px; align-items: start; }
.cond-k { display: flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; color: var(--ink-soft); padding-top: 3px; }
.ic { width: 22px; height: 22px; flex: none; }
.ic path { fill: none; stroke: var(--teal); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.cond-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.cond-chips i { font-style: normal; font-size: 13px; font-weight: 600; color: var(--ink); background: var(--paper); border-radius: 999px; padding: 5px 11px; line-height: 1.35; }
.cond-chips i.key { background: var(--gold); color: var(--ink); box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--gold); }
.cond-chips i.sup { background: #E3F4F5; color: #0F6F74; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .cond-art .ln { animation: draw 2.2s var(--ease) both; }
  .is-active .cond-art .soft { animation: fadeIn 1.2s ease .8s both; }
  .is-active .cond-art .pulse { animation: pop .8s var(--ease) 1.4s both, beat 1.4s ease-in-out 2.2s infinite; }
  .is-active .ic path { animation: draw 1.4s var(--ease) both; }
  .is-active .cond-chips i { animation: pop .5s var(--ease) both; }
  .is-active .cond-g:nth-child(1) .ic path, .is-active .cond-g:nth-child(1) i { animation-delay: .5s; }
  .is-active .cond-g:nth-child(2) .ic path, .is-active .cond-g:nth-child(2) i { animation-delay: .7s; }
  .is-active .cond-g:nth-child(3) .ic path, .is-active .cond-g:nth-child(3) i { animation-delay: .9s; }
  .is-active .cond-g:nth-child(4) .ic path, .is-active .cond-g:nth-child(4) i { animation-delay: 1.1s; }
  .is-active .cond-g:nth-child(5) .ic path, .is-active .cond-g:nth-child(5) i { animation-delay: 1.3s; }
  .is-active .cond-g:nth-child(6) .ic path, .is-active .cond-g:nth-child(6) i { animation-delay: 1.5s; }
  .is-active .cond-g:nth-child(7) .ic path, .is-active .cond-g:nth-child(7) i { animation-delay: 1.7s; }
  .is-active .cond-chips i.key { animation: pop .5s var(--ease) .7s both, glow 2s ease-in-out 1.8s infinite; }
}
@keyframes glow { 0%, 100% { box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--gold); } 50% { box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 9px rgba(212,162,58,.35); } }
@media (max-width: 600px) {
  .cond-head { grid-template-columns: 84px minmax(0, 1fr); gap: 12px; }
  .cond-art { width: 84px; }
  .cond-big { flex-direction: column; align-items: flex-start; gap: 4px; }
  .cond-g { grid-template-columns: 1fr; gap: 6px; }
}

/* Scene art (line drawings) */
.scene-art { width: min(260px, 70%); height: auto; align-self: center; }
.scene-art .ln { fill: none; stroke: var(--teal-bright); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.scene-art .soft { fill: rgba(79,209,217,.12); }
.scene-art .gold { fill: var(--gold); transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .scene-art .ln { animation: draw 2.2s var(--ease) both; }
  .is-active .scene-art .soft { animation: fadeIn 1.2s ease .8s both; }
  .is-active .scene-art .pulse { animation: pop .8s var(--ease) 1.4s both, beat 1.6s ease-in-out 2.2s infinite; }
}
.bed-art { width: min(200px, 55%); }

/* Answer form */
.form-card { background: rgba(255,255,255,.7); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; font-weight: 700; color: var(--ink-soft); }
.field input { font: 500 16px var(--sans); color: var(--ink); background: var(--paper); border: 2px solid #D6E1F0; border-radius: 10px; padding: 10px 12px; width: 100%; max-width: 420px; letter-spacing: 0; text-transform: none; }
.field input:focus-visible { outline: none; border-color: var(--teal); }
.limit-box { display: flex; flex-direction: column; gap: 10px; border-top: 1px dashed #C9D6E8; padding-top: 12px; }
@media (prefers-reduced-motion: no-preference) { .limit-box:not([hidden]) { animation: rise .5s var(--ease) both; } }

/* Tappable benefit cards */
.cv-btn { font: inherit; color: inherit; text-align: left; border: 2px solid transparent; cursor: pointer; display: flex; flex-direction: column; gap: 2px; position: relative; }
.cv-btn b { display: block; padding-right: 64px; }
.cv-btn .vs { display: flex; }
.cv-btn .more { position: absolute; top: 12px; right: 12px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--teal); background: #E3F4F5; border-radius: 999px; padding: 3px 9px; }
.cv-btn:hover { border-color: #9ED3D6; }
.cv-btn:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
.ci { font: 600 13px var(--sans); color: var(--ink); background: var(--paper); border: 0; border-radius: 999px; padding: 5px 11px 5px 22px; line-height: 1.35; cursor: pointer; position: relative; box-shadow: 0 0 0 2px #9ED3D6 inset; }
.ci::before { content: ""; position: absolute; left: 9px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%; background: var(--teal); }
.ci.key { background: var(--gold); box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--gold); }
.ci.key::before { background: var(--ink); }
.ci:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .cond-chips .ci { animation: pop .5s var(--ease) both; }
  .is-active .cond-g:nth-child(1) .ci { animation-delay: .5s; } .is-active .cond-g:nth-child(2) .ci { animation-delay: .7s; }
  .is-active .cond-g:nth-child(3) .ci { animation-delay: .9s; } .is-active .cond-g:nth-child(5) .ci { animation-delay: 1.3s; }
  .is-active .cond-g:nth-child(6) .ci { animation-delay: 1.5s; }
  .is-active .cond-chips .ci.key { animation: pop .5s var(--ease) .7s both, glow 2s ease-in-out 1.8s infinite; }
}

/* Detail sheet */
.sheet-bg { position: absolute; inset: 0; z-index: 7; background: rgba(11,37,69,.45); }
.sheet { position: absolute; z-index: 8; left: max(16px, env(safe-area-inset-left, 0px)); right: max(16px, env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); margin-inline: auto; max-width: 620px; max-height: calc(100% - 48px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); overflow-y: auto; background: var(--paper); color: var(--ink); border-radius: 20px; padding: 22px 20px 20px; box-shadow: 0 24px 60px rgba(11,37,69,.35); }
@media (prefers-reduced-motion: no-preference) { .sheet:not([hidden]) { animation: rise .45s var(--ease) both; } .sheet-bg:not([hidden]) { animation: fadeIn .3s ease both; } }
.sheet-x { position: absolute; top: 10px; right: 10px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: #EEF3F8; color: var(--ink); font-size: 22px; cursor: pointer; }
.sheet-x:focus-visible, .sheet-go:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
.sheet .sk { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--teal); }
.sheet h3 { font-family: var(--serif); font-size: clamp(22px, 4vw, 30px); font-weight: 600; margin: 4px 48px 8px 0; line-height: 1.15; text-wrap: balance; }
.sheet p { font-size: 15px; }
.sheet .pw { font-size: 17px; color: var(--ink); line-height: 1.5; }
.sl { list-style: none; margin: 12px 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sl li { background: #F3F7FB; border-radius: 10px; padding: 9px 12px; font-size: 14.5px; }
.sl li b { display: block; }
.sl li span { font-size: 13px; color: var(--ink-soft); }
@media (prefers-reduced-motion: no-preference) {
  .sl li { animation: rise .5s var(--ease) both; }
  .sl li:nth-child(2) { animation-delay: .06s; } .sl li:nth-child(3) { animation-delay: .12s; } .sl li:nth-child(4) { animation-delay: .18s; }
  .sl li:nth-child(5) { animation-delay: .24s; } .sl li:nth-child(6) { animation-delay: .3s; } .sl li:nth-child(7) { animation-delay: .36s; } .sl li:nth-child(8) { animation-delay: .42s; }
}
.sv { display: flex; flex-direction: column; gap: 6px; background: var(--night); color: #fff; border-radius: 12px; padding: 12px 14px; margin: 12px 0 8px; font-size: 14px; line-height: 1.45; }
.sv b { color: var(--teal-bright); }
.sheet-go { font: 700 14px var(--sans); color: #fff; background: var(--teal); border: 0; border-radius: 999px; padding: 12px 18px; cursor: pointer; margin-top: 8px; }

/* Pictures */
.pic { display: block; width: min(280px, 100%); height: auto; margin: 8px auto 4px; }
.pic .ln { fill: none; stroke: var(--teal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.pic .soft { fill: rgba(23,141,147,.10); }
.pic .ghost { fill: none; stroke: #A9B6C8; stroke-width: 3; stroke-dasharray: 6 6; stroke-linecap: round; }
.pic .hot { fill: rgba(194,85,63,.22); stroke: var(--coral); stroke-width: 3; transform-box: fill-box; transform-origin: center; }
.pic .hot-ln { fill: none; stroke: var(--coral); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.pic .ray { fill: none; stroke: var(--teal-bright); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 6 8; }
.pic .yel { fill: #F4D35E; stroke: #C99A1E; stroke-width: 2; }
.pic .drop { fill: rgba(79,209,217,.5); stroke: var(--teal); stroke-width: 2; }
.pic .cloud { fill: #E6ECF2; stroke: #B9C6D4; stroke-width: 2; transform-box: fill-box; transform-origin: center; }
.pic .cloud2 { fill: #FFFFFF; opacity: .85; }
@media (prefers-reduced-motion: no-preference) {
  .pic .ln, .pic .hot-ln { animation: draw 1.8s var(--ease) both; }
  .pic .hot-ln { animation-delay: .9s; }
  .pic .soft, .pic .yel, .pic .drop, .pic .cloud2 { animation: fadeIn 1s ease .6s both; }
  .pic .ray { animation: flow 1.2s linear infinite; }
  .pic .hot { animation: pop .7s var(--ease) 1s both; }
  .pic .pulse { animation: pop .7s var(--ease) 1s both, beat 1.6s ease-in-out 1.8s infinite; }
}
@keyframes flow { to { stroke-dashoffset: -28; } }

/* Smart Value Point bar */
.svp { display: flex; flex-direction: column; gap: 8px; }
.svp-track { display: flex; height: 44px; border-radius: 12px; overflow: hidden; background: rgba(11,37,69,.08); }
.svp-full { flex: 0 0 72%; background: var(--teal); color: #fff; display: flex; align-items: center; padding-left: 14px; font-size: 13px; font-weight: 700; transform-origin: left; }
.svp-over { flex: 1; background: repeating-linear-gradient(45deg, #178D93 0 10px, #C2553F 10px 13px); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; transform-origin: left; }
.svp-over span, .svp-full span { text-shadow: 0 1px 2px rgba(11,37,69,.5); white-space: nowrap; }
.svp-labels { display: grid; grid-template-columns: 1fr auto 1fr; font-size: 12.5px; color: var(--ink-soft); }
.svp-labels span:nth-child(2) { text-align: center; color: var(--ink); }
.svp-labels span:last-child { text-align: right; }
@media (prefers-reduced-motion: no-preference) {
  .slide .svp-full, .slide .svp-over { transform: scaleX(0); }
  .is-active .svp-full { transform: scaleX(1); transition: transform 1.4s var(--ease) .4s; }
  .is-active .svp-over { transform: scaleX(1); transition: transform 1s var(--ease) 1.8s; }
}

/* Medical card benefit columns */
.mc-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.mc-col { background: rgba(255,255,255,.06); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; text-align: left; }
.mc-k { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--teal-bright); }
.mc-row { background: var(--paper); color: var(--ink); border-radius: 10px; padding: 9px 12px; }
.mc-row b { display: block; font-size: 14px; }
.mc-row em { font-style: normal; display: block; font-weight: 700; color: var(--teal); font-size: 13.5px; margin-top: 2px; }
.mc-row span { display: block; font-size: 12.5px; color: var(--ink-soft); }
@media (prefers-reduced-motion: no-preference) {
  .is-active .mc-row { animation: rise .55s var(--ease) both; }
  .is-active .mc-col .mc-row:nth-child(2) { animation-delay: .4s; } .is-active .mc-col .mc-row:nth-child(3) { animation-delay: .5s; }
  .is-active .mc-col .mc-row:nth-child(4) { animation-delay: .6s; } .is-active .mc-col .mc-row:nth-child(5) { animation-delay: .7s; }
  .is-active .mc-col .mc-row:nth-child(6) { animation-delay: .8s; } .is-active .mc-col .mc-row:nth-child(7) { animation-delay: .9s; }
  .is-active .mc-col .mc-row:nth-child(8) { animation-delay: 1s; }
}

/* Send answers */
.send-box { width: 100%; background: rgba(255,255,255,.8); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; text-align: left; }
.send-summary { font-size: 13.5px; line-height: 1.55; color: var(--ink); white-space: pre-line; }
.send-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.send-btn { font: 700 15px var(--sans); color: #fff; background: var(--teal); border: 0; border-radius: 999px; padding: 12px 20px; cursor: pointer; }
.send-btn:disabled { opacity: .55; cursor: default; }
.copy-btn { font: 600 14px var(--sans); color: var(--ink); background: var(--paper); border: 2px solid #C9D6E8; border-radius: 999px; padding: 10px 16px; cursor: pointer; }
.send-btn:focus-visible, .copy-btn:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
.send-status { font-size: 13.5px; line-height: 1.45; min-height: 1em; }
.send-status.ok { color: #0F6F74; font-weight: 700; }
.send-status.warn { color: #9A3F2D; font-weight: 600; }
.cover-for { font-family: var(--serif); font-style: italic; font-size: clamp(20px, 3.4vw, 26px); color: var(--ink); }
.cover-for b { font-style: normal; color: var(--teal); font-weight: 700; }

@media (max-width: 600px) {
  .mc-cols { grid-template-columns: 1fr; }
  .svp-full span { font-size: 11px; }
}


.photo { display: block; width: 100%; max-width: 520px; max-height: 46vh; object-fit: contain; margin: 8px auto 0; border-radius: 12px; background: #F3F7FB; }
@media (prefers-reduced-motion: no-preference) { .photo { animation: rise .6s var(--ease) both; } }
.credit { font-size: 11.5px !important; color: var(--ink-soft); text-align: center; margin-top: 4px !important; }


.step-k { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--mist-2); font-weight: 600; }
.limit-track { width: min(420px, 100%); height: 18px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; display: flex; }
.limit-base { width: 55%; background: var(--teal-bright); }
.limit-boost { width: 45%; background: var(--gold); transform-origin: left; }
@media (prefers-reduced-motion: no-preference) {
  .slide .limit-boost { transform: scaleX(0); }
  .is-active .limit-boost { transform: scaleX(1); transition: transform 1.4s var(--ease) 1s; }
}
.limit-labels { width: min(420px, 100%); display: flex; justify-content: space-between; font-size: 13px; color: var(--mist); }


/* Fix: tall scenes start at the top instead of clipping above the screen */
.slide { justify-content: flex-start; }
.slide > .inner { margin-block: auto; }

/* Savings jar */
.jar-glass { fill: rgba(238,243,248,.12); stroke: #0B2545; stroke-width: 3; }
.jar-lid { fill: #C9D6E8; stroke: #0B2545; stroke-width: 3; }
.jar-shine { stroke: #FFFFFF; stroke-width: 4; stroke-linecap: round; opacity: .8; }
.jar-fill { fill: rgba(212,162,58,.28); }
.jar-stack ellipse { fill: #D4A23A; stroke: #A87D22; stroke-width: 1.5; }
.jar-cap { stroke: var(--coral); stroke-width: 2; stroke-dasharray: 4 4; opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .jar-fill { animation: jarRise 3.2s var(--ease) .6s both; }
  .is-active .jar-stack ellipse { animation: pop .5s var(--ease) both; transform-box: fill-box; transform-origin: center; }
  .is-active .jar-stack ellipse:nth-child(1) { animation-delay: .9s; } .is-active .jar-stack ellipse:nth-child(4) { animation-delay: 1.2s; }
  .is-active .jar-stack ellipse:nth-child(2) { animation-delay: 1.6s; } .is-active .jar-stack ellipse:nth-child(5) { animation-delay: 2s; }
  .is-active .jar-stack ellipse:nth-child(3) { animation-delay: 2.4s; }
  .is-active .jar-cap { animation: fadeIn .6s ease 3.4s both; }
}
@keyframes jarRise { from { transform: translateY(44px); } to { transform: none; } }

/* Tabarru' fund network */
.net-line { stroke: rgba(79,209,217,.6); stroke-width: 2; stroke-dasharray: 4 5; fill: none; }
.net-out { stroke: var(--gold); stroke-width: 3; stroke-dasharray: 5 5; fill: none; opacity: 0; }
.node circle, .node path { fill: none; stroke: var(--teal-bright); stroke-width: 2.5; stroke-linecap: round; }
.node.help circle, .node.help path { stroke: var(--gold); stroke-width: 3; }
.node { transform-box: fill-box; transform-origin: center; }
.fund-coin { fill: var(--gold); stroke: #F2D08A; stroke-width: 2; transform-box: fill-box; transform-origin: center; }
.fund-ring { fill: none; stroke: var(--gold); stroke-width: 2; transform-box: fill-box; transform-origin: center; opacity: 0; }
.fund-mark { fill: none; stroke: #0B2545; stroke-width: 2.4; stroke-linecap: round; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .node { animation: pop .6s var(--ease) both; }
  .is-active .net-line { animation: fadeIn .6s ease 1s both, flowIn 1.2s linear 1s infinite; }
  .is-active .fund-coin { animation: pop .7s var(--ease) .9s both, beat 1.8s ease-in-out 2s infinite; }
  .is-active .fund-ring { animation: ripple 2.2s ease-out 1.6s infinite; }
  .is-active .net-out { animation: fadeIn .5s ease 2.4s both, flowIn 1s linear 2.4s infinite; }
  .is-active .node.help { animation: pop .6s var(--ease) .6s both, helpGlow 1.8s ease-in-out 2.8s infinite; }
}
@keyframes flowIn { to { stroke-dashoffset: -18; } }
@keyframes ripple { 0% { transform: scale(1); opacity: .8; } 100% { transform: scale(2.6); opacity: 0; } }
@keyframes helpGlow { 0%, 100% { filter: none; } 50% { filter: drop-shadow(0 0 6px rgba(212,162,58,.9)); } }

/* Photo backgrounds on journey scenes */
.slide.photo-bg { background: var(--night); }
.slide.photo-bg::before { content: ""; position: absolute; inset: 0; background-image: var(--bg); background-size: cover; background-position: center; transform: scale(1.06); }
.slide.photo-bg::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(11,37,69,.72) 0%, rgba(11,37,69,.82) 45%, rgba(11,37,69,.94) 100%); }
.slide.photo-bg > .inner { position: relative; z-index: 1; }
@media (prefers-reduced-motion: no-preference) {
  .slide.photo-bg.is-active::before { animation: kenburns 14s ease-out both; }
}
@keyframes kenburns { from { transform: scale(1.18) translateY(-1.5%); } to { transform: scale(1.04); } }


/* AnugerahMax additions */
.bars5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.bars6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.bar-pair { gap: 4px; }
.bar.thin { width: 40%; }
.bar.gold { background: var(--gold); }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--ink-soft); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.limit-base.half, .limit-boost.half { width: 50%; }
.tl4 .tl-points { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.mc-btn { font: inherit; text-align: left; border: 2px solid transparent; cursor: pointer; position: relative; width: 100%; }
.mc-btn b { padding-right: 64px; }
.mc-btn .more { position: absolute; top: 9px; right: 10px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--teal); background: #E3F4F5; border-radius: 999px; padding: 3px 9px; }
.mc-btn:hover { border-color: #9ED3D6; }
.mc-btn:focus-visible { outline: 3px solid var(--teal-bright); outline-offset: 2px; }
.cover-art { width: 110px; }

/* Growth chart */
.chart { width: 100%; height: auto; overflow: visible; }
.chart .grid { stroke: rgba(11,37,69,.08); stroke-width: 1; }
.chart .axis { fill: var(--ink-soft); font-size: 15px; font-family: var(--sans); }
.chart .lineY { fill: none; stroke: var(--ink); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.chart .lineX { fill: none; stroke: var(--teal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.chart .areaY { fill: rgba(11,37,69,.06); }
.chart .peak { fill: var(--gold); stroke: #fff; stroke-width: 2; }
.chart .peak-t { font-size: 16px; font-weight: 700; fill: var(--ink); font-family: var(--sans); }
@media (prefers-reduced-motion: no-preference) {
  .is-active .chart .lineY, .is-active .chart .lineX { animation: draw 2.6s var(--ease) both; }
  .is-active .chart .lineX { animation-delay: .4s; }
  .is-active .chart .areaY { animation: fadeIn 1.5s ease 1.4s both; }
  .is-active .chart .peak, .is-active .chart .peak-t { animation: fadeIn .6s ease 2.6s both; }
}
.scen { display: flex; gap: 10px; flex-wrap: wrap; }
.scen div { background: var(--paper); border-radius: 10px; padding: 10px 14px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.scen i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
@media (max-width: 600px) {
  .tl4 .tl-points { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 18px; }
  .tl4 .tl-line, .tl4 .tl-fill { display: none; }
}


/* Option comparison table */
.cmp-wrap { overflow-x: auto; border-radius: 14px; background: var(--paper); box-shadow: 0 8px 24px rgba(11,37,69,.08); }
.cmp { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 13.5px; line-height: 1.4; color: var(--ink); }
.cmp th, .cmp td { text-align: left; padding: 8px 12px; vertical-align: top; border-bottom: 1px solid #E6EDF5; }
.cmp thead th { font-family: var(--serif); font-size: 18px; font-weight: 700; background: #F3F7FB; position: sticky; top: 0; }
.cmp thead th span { display: block; font-family: var(--sans); font-size: 12px; font-weight: 600; color: var(--ink-soft); }
.cmp thead th.o2 { background: var(--night); color: #fff; }
.cmp thead th.o2 span { color: var(--teal-bright); }
.cmp td:first-child { width: 34%; font-weight: 600; }
.cmp td:nth-child(2) { width: 30%; color: var(--ink-soft); }
.cmp td:nth-child(3) { background: rgba(23,141,147,.05); }
.cmp td.none { color: #A3AEBF; font-style: italic; }
.cmp tr.grp td { background: #EEF3F8; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--teal); padding: 6px 12px; }
.tag { font-style: normal; display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; border-radius: 999px; padding: 2px 7px; margin-left: 4px; vertical-align: 1px; white-space: nowrap; }
.tag.up { background: #E3F4F5; color: #0F6F74; }
.tag.new { background: #FBF1DC; color: #8A6412; }
.tag.down { background: #FBEDE9; color: #9A3F2D; }
.tag.same { background: #EEF1F5; color: #5A6B85; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .cmp tbody tr { animation: rise .5s var(--ease) both; }
  .is-active .cmp tbody tr:nth-child(n+2) { animation-delay: .35s; }
  .is-active .cmp tbody tr:nth-child(n+6) { animation-delay: .5s; }
  .is-active .cmp tbody tr:nth-child(n+10) { animation-delay: .65s; }
  .is-active .cmp tbody tr:nth-child(n+14) { animation-delay: .8s; }
  .is-active .cmp tbody tr:nth-child(n+18) { animation-delay: .95s; }
  .is-active .cmp tbody tr:nth-child(n+22) { animation-delay: 1.1s; }
  .is-active .tag.new, .is-active .tag.up { animation: pop .5s var(--ease) 1.3s both; }
}
.why { background: var(--night); color: #fff; border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.why-k { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: var(--teal-bright); }
.why-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.why-c { background: rgba(255,255,255,.07); border-radius: 12px; padding: 12px; min-width: 0; }
.why-c b { display: block; font-family: var(--serif); font-size: 19px; color: #fff; margin-bottom: 4px; }
.why-c span { font-size: 13px; line-height: 1.45; color: var(--mist); }
.why-t { font-size: 13.5px; color: var(--mist); max-width: none; }
.why-t b { color: #F2A65A; }
@media (max-width: 600px) { .why-grid { grid-template-columns: 1fr; } .cmp { min-width: 0; font-size: 12px; } .cmp th, .cmp td { padding: 7px 7px; } .cmp thead th { font-size: 14px; } .cmp td:first-child { width: 30%; } .cmp td:nth-child(2) { width: 32%; } .tag { font-size: 9.5px; padding: 1px 5px; margin-left: 0; margin-top: 3px; } }


.form-link { display: inline-flex; align-items: center; gap: 10px; background: var(--gold); color: var(--ink); font: 700 16px var(--sans); text-decoration: none; border-radius: 999px; padding: 14px 24px; box-shadow: 0 10px 24px rgba(212,162,58,.35); }
.form-link:hover { filter: brightness(1.05); }
.form-link:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
@media (prefers-reduced-motion: no-preference) { .is-active .form-link { animation: pop .6s var(--ease) 1.2s both, ringGold 2.4s ease-in-out 2s infinite; } }
@keyframes ringGold { 0%, 100% { box-shadow: 0 10px 24px rgba(212,162,58,.35), 0 0 0 0 rgba(212,162,58,.45); } 50% { box-shadow: 0 10px 24px rgba(212,162,58,.35), 0 0 0 14px rgba(212,162,58,0); } }

/* Controls */
.chrome { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; align-items: center; gap: 10px;
  padding-block: 12px calc(12px + env(safe-area-inset-bottom, 0px));
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); pointer-events: none; }
.chrome > * { pointer-events: auto; }
.nav { width: 44px; height: 44px; border-radius: 50%; border: 0; background: rgba(11,37,69,.85); color: #fff; font-size: 20px; cursor: pointer; display: grid; place-items: center; flex: none; }
.nav:disabled { opacity: .3; cursor: default; }
.nav:focus-visible, .notes-btn:focus-visible { outline: 3px solid var(--teal-bright); outline-offset: 2px; }
.notes-btn { height: 44px; border-radius: 999px; border: 0; padding: 0 14px; background: rgba(11,37,69,.85); color: #fff; font: 600 12px var(--sans); letter-spacing: .06em; text-transform: uppercase; cursor: pointer; flex: none; }
.progress { flex: 1; display: flex; gap: 4px; min-width: 0; }
.progress span { flex: 1; height: 4px; border-radius: 4px; background: rgba(11,37,69,.15); overflow: hidden; }
.progress span.on::after { content: ""; display: block; height: 100%; background: var(--teal); }
.night-chrome .progress span { background: rgba(255,255,255,.2); }
.night-chrome .nav, .night-chrome .notes-btn { background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
.night-chrome .progress span.on::after { background: var(--teal-bright); }
.counter { font-size: 12px; font-weight: 600; color: var(--ink-soft); font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; }
.night-chrome .counter { color: var(--mist); }
.ribbon { position: absolute; top: calc(12px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 5; font-size: 11.5px; font-weight: 600; letter-spacing: .04em; background: rgba(255,255,255,.85); color: var(--ink); padding: 6px 12px; border-radius: 999px; white-space: nowrap; max-width: calc(100% - 32px); overflow: hidden; text-overflow: ellipsis; }

/* Presenter notes */
.notes { display: none; }
.notes-panel { position: absolute; z-index: 6; left: max(16px, env(safe-area-inset-left, 0px)); right: max(16px, env(safe-area-inset-right, 0px)); bottom: calc(76px + env(safe-area-inset-bottom, 0px)); margin-inline: auto; max-width: 760px; max-height: 45%; overflow-y: auto; background: #FFFDF6; color: var(--ink); border-radius: 14px; padding: 14px 16px; box-shadow: 0 16px 40px rgba(11,37,69,.28); font-size: 14px; line-height: 1.55; }
.notes-panel .nk { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--coral); margin-bottom: 6px; }
.notes-panel p { color: var(--ink); font-size: 14px; margin-top: 6px; max-width: none; }

@keyframes draw { from { stroke-dashoffset: 1200; } to { stroke-dashoffset: 0; } }
@keyframes pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes rise { from { transform: translateY(30px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes nudge { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
@keyframes beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.25); } 30% { transform: scale(1); } 45% { transform: scale(1.18); } }
@keyframes coinFall { 0% { opacity: 0; transform: translateY(-26px); } 20% { opacity: 1; } 75% { opacity: 1; transform: translateY(34px); } 100% { opacity: 0; transform: translateY(40px); } }
@keyframes breathe { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes startle { 0%, 100% { transform: rotate(0) scale(1); } 25% { transform: rotate(-6deg) scale(1.06); } 75% { transform: rotate(6deg) scale(1.06); } }
@keyframes ring { 0%, 100% { box-shadow: 0 0 0 0 rgba(23,141,147,.4); } 50% { box-shadow: 0 0 0 22px rgba(23,141,147,0); } }

@media (max-width: 600px) {
  .slide { padding-block: 56px 92px; }
  .donut-wrap, .pyr-wrap { grid-template-columns: 1fr; justify-items: center; }
  .split { width: 100%; }
  .options, .agenda, .qs { grid-template-columns: 1fr; }
  .glance { grid-template-columns: 1fr; }
  .glance.two { grid-template-columns: 1fr; }
  .bars { height: 190px; gap: 4px; }
  .bar-val { font-size: 10px; }
  .tl-pt .day { font-size: 18px; }
  .paths { gap: 10px; }
  .path { padding: 14px 10px; }
  .hrow { grid-template-columns: 92px minmax(0, 1fr) 52px; }
  .hrow .val { font-size: 19px; }
}
`;

module.exports = { STORY_CSS };
