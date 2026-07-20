# Project Status

**Last updated:** 2026-07-20

## Current Version

**v1.6.0** (`v1.6.0-phase6-airtable`) — `package.json` currently reports `1.2.0`; this predates the Phase 4–6 work and should be bumped to match the latest tag the next time a version-related change is made.

## Completed Phases

| Phase | Tag | Status |
|---|---|---|
| Phase 1 — PDF Parser | `v1.0-phase1-parser` | ✅ Done, frozen 2026-07-20 |
| Phase 2 — Renderer | `v1.1-phase2-renderer` | ✅ Done, frozen |
| Phase 3 — Browser-based tool | `v1.2-phase3-browser-tool` | ✅ Done |
| Phase 3 fix — Real-PDF extraction bugs | `v1.2.1-browser-real-pdf-fix` | ✅ Done |
| Phase 4 — Client application workflow | `v1.5.0-mvp` | ✅ Done |
| Phase 5 — Submission pipeline (queue, adapters) | `v1.5.0-mvp` | ✅ Done |
| Phase 6 — Airtable submission destination | `v1.6.0-phase6-airtable` | ✅ Done |

## Frozen Architecture Components

These are approved and, per working agreement, should not be modified except for a verified bug (see [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for what counts as a documented limitation vs. an actual bug):

- **`parser/`** — the entire Phase 1 extraction surface (all 8 extractors, `lineUtils.js`, `validate.js`, `parseQuotation.js`, `agents.js`). Anything consuming it should only import from `parser/index.js`.
- **`renderer/`** — the entire Phase 2 rendering surface. Consumes only `parseQuotation()`'s output; no parsing logic of its own.
- **`browser-tool/application/submission.js`** — the original Phase 4 submission-object builder, kept unmodified and wrapped (not replaced) by the Phase 5 `models/SubmissionPayload.js`.

Non-frozen, actively evolving surfaces: `browser-tool/app.js`, `browser-tool/pdfTextSource.browser.js`, `browser-tool/application/` (beyond `submission.js`), `browser-tool/destinations/`, `browser-tool/queue/`, `browser-tool/services/`, `browser-tool/models/`.

## Current Project Status

The tool is feature-complete end to end: an agent can open `browser-tool/index.html`, upload a real PruBSN Product Illustration PDF, review and edit any flagged field, generate and download a client-facing quotation, and that quotation now carries its own multi-step application form. A client who opens the file and applies has their submission durably queued client-side and delivered to a live Airtable Automation webhook, with retry on failure.

Known gaps carried forward from the parser's design (see [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for full detail):

- Verified against exactly **one** real sample PDF; anchors are trusted, not yet re-confirmed, across other ages/genders/plan tiers.
- `validate.js`'s plan-tier/annual-limit cross-check only recognizes "Plan 200".
- Parser anchors and the benefit-label dictionary are specific to PruBSN AnugerahMax + Medic TotalCare — a different product or rider would need its own review.
- The separate legacy client intake form (`PruBSN Client Form - Standalone updated.html`, outside this repo) still POSTs directly to the Airtable API with an embedded, full read/write Personal Access Token — flagged during Phase 1 planning as a security issue, not yet fixed, and out of scope for this repo's own code.

## Next Development Phase

**Phase 7** (planning) — see [ROADMAP.md](ROADMAP.md) for the full breakdown. Leading candidates, carried forward from earlier planning docs ([docs/ROADMAP.md](docs/ROADMAP.md)) and not yet started:

- Fix the legacy intake form's exposed Airtable token (replace with a proxy/webhook, following the same pattern already used by `AirtableDestination.js`).
- Multi-agent UI polish: let an agent select/edit the active agent in the browser tool rather than relying on a single hardcoded agent.
- Run the parser against 2–3 additional real client PDFs (different ages, genders, plan tiers) and treat any new failure as a real parser bug.
