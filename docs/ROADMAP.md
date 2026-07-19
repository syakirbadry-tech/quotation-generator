# Roadmap

## Phase 1 — PDF Parser ✅ Done, frozen 2026-07-20

Modular, anchor-driven parser that turns a PruBSN AnugerahMax + Medic TotalCare Product Illustration PDF into structured `{ data, warnings, errors }`. See [PHASE1_SUMMARY.md](PHASE1_SUMMARY.md), [PARSER_API.md](PARSER_API.md), [TEST_RESULTS.md](TEST_RESULTS.md).

Frozen by agreement — do not modify except for a verified bug (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for what counts as documented behavior vs. an actual bug).

## Phase 2 — Renderer 🚧 In progress

Build the piece that turns `parseQuotation()`'s `data` object into the actual client-facing quotation document.

**Hard constraints (per approval):**
- Consumes only `parseQuotation()`'s output — no PDF parsing logic of its own.
- Reuses the existing [`medical-card-quotation.html`](../../medical-card-quotation.html) design rather than rebuilding it from scratch — that file's markup/CSS becomes the template; its hardcoded values become data-driven fields.
- Output is HTML only (no PDF export — decided earlier when scoping this project).

**Design work needed:**
- Map every `data.*` field to a spot in the existing template (most map directly; the Options section needs to go from 3 fixed hardcoded cards to `data.options.columns`-driven cards; the Benefits table needs to handle `value: null` merged-cell rows gracefully; `quotationNumber`/`validUntil` need to render as visibly agent-editable rather than as printed fact, since they're generated, not extracted).
- Decide how `warnings`/`errors` surface in the rendered output (e.g. a review/edit pass before the agent sends the file, vs. inline flags on the document itself).
- Agent block (name, license, dealership, location) pulls from `getAgentConfig(data.agent.agentCode)`, not from the parsed PDF data.

## Phase 3 — Browser-based single-file tool

Package the parser + renderer into one self-contained HTML file an agent can open directly (no install, no server), matching the pattern already used by this project's other files:

- Replace the Node/`pdftotext` dev backend with a `pdf.js`-based text extractor that runs entirely client-side (nothing gets uploaded anywhere — this is a privacy improvement over the current intake-form flow, not just a packaging change).
- Drag-and-drop / file-picker PDF upload → live preview of the rendered quotation.
- Manual-edit mode: any field flagged by a warning (or missing due to an error) must be editable by the agent before the quotation is considered final — per the "never invent data, always allow manual editing" rule from Phase 1.
- "Download HTML" to save the finished quotation as a file to send to the client.
- Re-verify the layout-dependent extraction techniques (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) item 7) against real `pdf.js` output before shipping.

## Phase 4 — Security fix: intake form's exposed Airtable token

Independent of the quotation generator, but flagged during this project's initial analysis and agreed to be in scope: [`PruBSN Client Form - Standalone updated.html`](../../PruBSN%20Client%20Form%20-%20Standalone%20updated.html) currently POSTs directly to the Airtable API from the browser with a live, full-read/write Personal Access Token embedded in the page source — visible to anyone who views-source on a file meant to be sent to clients. Replace the direct client-side Airtable call with a proxy (e.g. an Airtable Automation triggered by a webhook) so the real token never ships inside client-facing HTML.

## Phase 5 — Multi-agent polish

- UI for selecting/editing the active agent (backed by `AGENTS` in `agents.js`) rather than a single hardcoded agent.
- Extend `KNOWN_PLAN_TIER_ANNUAL_LIMITS` in `validate.js` as quotations for other plan tiers (beyond "Plan 200") are seen.
- Run the parser against additional real client PDFs (different ages, genders, plan tiers) and treat any new failure as a real parser bug — the one exception to the Phase 1 freeze.

## Explicitly out of scope / deferred indefinitely

- **PDF export of the rendered quotation** — decided against; HTML-only is the approved design.
- **OCR / scanned-PDF support** — the parser only handles PruBSN's system-generated text-layer PDF.
- **Full year-by-year cash-flow / surrender-value illustration tables** (PDF pages covering multi-decade projections) — not used by the current quotation template; would need its own extraction-model review if ever wanted (e.g. for a "cash value over time" chart feature).
- **Support for PruBSN products other than AnugerahMax + Medic TotalCare** — would need a fresh anchor/dictionary review per [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) item 9.
