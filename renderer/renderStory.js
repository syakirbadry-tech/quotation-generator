/**
 * renderStory.js
 *
 * The animated "story" presentation: a full-screen, tap-through deck
 * (opening statistics, a two-paths story, the client's own questions,
 * then their plan step by step, options side by side and a Send button
 * that delivers their answers to the agent's portal).
 *
 * Input is the same parseQuotation() output the rest of the renderer
 * uses - one quotation, or 2-3 for a side-by-side options scene. The
 * first quotation drives the story; the others appear in the options
 * comparison. Output is one standalone HTML document.
 *
 * Product differences live in renderer/story/products/ - see the
 * header comment there for how to add a product.
 */

'use strict';

const { STORY_CSS } = require('./story/storyStyles.js');
const { STORY_RUNTIME_JS } = require('./story/storyRuntime.js');
const { buildStoryModel } = require('./story/storyModel.js');
const { productFor } = require('./story/products/index.js');
const { SCENES, esc } = require('./story/scenes.js');
const { getAgentConfig } = require('../parser/agents.js');

const STORY_RENDERER_VERSION = 'story-v1';

// Story photos are served from the tool's own GitHub Pages site, so a
// published deck (which lives on the Worker's origin) can still load them.
// /browser-tool/assets/ exists under both ways Pages can publish this repo (see AssetManager.js).
const DEFAULT_ASSET_BASE = 'https://syakirbadry-tech.github.io/quotation-generator/browser-tool/assets/story/';
const DEFAULT_PORTAL = 'https://prubsn-submission-service.syakirbadry.workers.dev/presentation-answers';

// Presentation-only details per agent code (the parser's AGENTS config
// holds the formal ones). `short` is the name clients know them by.
const STORY_AGENTS = {
  '8LT00006': {
    short: 'Syakir',
    formUrl: 'https://syakirbadry-tech.github.io/Client-Form/client-detail-form.html',
  },
};

function agentProfile(model, overrides = {}) {
  const code = model.agentCode || null;
  const formal = getAgentConfig(code) || {};
  const extra = STORY_AGENTS[code] || {};
  const name = formal.name || (model.agentNameOnDocument ? model.agentNameOnDocument.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : 'Your takaful agent');
  return {
    code,
    name,
    short: extra.short || name.split(/\s+/)[0],
    agency: formal.agency || 'PruBSN',
    tagline: 'Anda Inspirasi Kami',
    formUrl: extra.formUrl || '',
    formCode: '',
    ...overrides,
  };
}

/**
 * @param {Array<{data: object}>|{data: object}} quotations 1-3 parseQuotation() results (the first drives the story)
 * @param {object} [options]
 * @param {boolean} [options.presenterNotes=false] keep the agent's speaking notes (agent preview only - never for clients)
 * @param {object} [options.agent] overrides for the agent profile (name, short, agency, formUrl, formCode, tagline)
 * @param {string} [options.assetBase] where the story photos are served from
 * @param {string} [options.portalUrl] where Send posts the client's answers
 * @param {string} [options.vbId] the portal VB prospect this deck is for, so the client's answers show on that name
 * @returns {string} a complete HTML document
 */
function renderStoryHtml(quotations, options = {}) {
  const list = (Array.isArray(quotations) ? quotations : [quotations]).filter((q) => q && q.data).slice(0, 3);
  if (!list.length) throw new Error('renderStoryHtml needs at least one parsed quotation.');
  const models = list.map((q) => buildStoryModel(q.data, productFor(q.data)));
  const m = models[0];
  const agent = agentProfile(m, options.agent);
  const assetBase = options.assetBase || DEFAULT_ASSET_BASE;
  const ctx = { models, agent, photo: (name) => `${assetBase}${name}.jpg` };

  let scenes = SCENES.map((scene) => scene(m, ctx)).filter(Boolean).join('\n');
  scenes = scenes.replace('class="slide', 'class="slide is-active');
  if (!options.presenterNotes) scenes = scenes.replace(/<div class="notes">[\s\S]*?<\/div>/g, '');

  const who = m.unborn ? (m.parentName ? `${m.parentCallName}’s baby` : 'Your baby') : m.callName;
  const title = `${who ? `${who}’s ` : ''}${m.product.name} plan`;
  const clientLabel = m.unborn ? (m.parentName ? `${m.parentName} (for her baby)` : 'Unborn child') : m.fullName || 'Client';
  const ribbon = `Prepared for ${clientLabel}${m.quoteDate ? ` · PruBSN quotation dated ${m.quoteDate}` : ''}`;

  const cfg = {
    client: clientLabel,
    source: `${m.product.name} story presentation`,
    agentShort: agent.short,
    agentFormCode: agent.formCode || '',
    vbId: /^[0-9a-f-]{36}$/.test(options.vbId || '') ? options.vbId : '',
    portal: options.portalUrl || DEFAULT_PORTAL,
    peopleOn: 9,
    cashValue: m.cash.points && m.cash.points.length >= 3 ? {
      axisLabel: 'Year',
      points: m.cash.points,
      peaks: [m.cash.points.reduce((a, r) => (r[2] > a[2] ? r : a)), m.cash.points.reduce((a, r) => (r[1] > a[1] ? r : a))].map((r, i) => [r[0], r[i === 0 ? 2 : 1]]),
    } : null,
  };
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="generator" content="${STORY_RENDERER_VERSION}">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,500&display=swap">
<style>${STORY_CSS}
[hidden]{display:none!important}
.slide:not(.night) .limit-labels{color:var(--ink-soft)}</style>
</head>
<body id="pq-story">
<div class="deck" id="deck">
  <div class="ribbon" id="ribbon">${esc(ribbon)}</div>
${scenes}
  <div class="sheet-bg" id="sheetBg" hidden></div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" hidden>
    <button class="sheet-x" id="sheetX" type="button" aria-label="Close">×</button>
    <div id="sheetBody"></div>
  </div>
  ${options.presenterNotes ? '<div class="notes-panel" id="notesPanel" hidden><div class="nk">Presenter notes · press N to hide</div><div id="notesBody"></div></div>' : ''}
  <div class="chrome" id="chrome">
    <button class="nav" id="prev" type="button" aria-label="Previous">‹</button>
    <div class="progress" id="progress" aria-hidden="true"></div>
    <span class="counter" id="counter"></span>
    ${options.presenterNotes ? '<button class="notes-btn" id="notesBtn" type="button" aria-pressed="false">Notes</button>' : ''}
    <button class="nav" id="next" type="button" aria-label="Next">›</button>
  </div>
</div>
<script type="application/json" id="story-data">${json}</script>
<script>${STORY_RUNTIME_JS}</script>
</body>
</html>`;
}

module.exports = { renderStoryHtml, STORY_RENDERER_VERSION, buildStoryModel };
