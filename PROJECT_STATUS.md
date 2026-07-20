# Project Status

**Last updated:** 2026-07-21

## Current Version

**v1.7.0** (`v1.7.0-phase7-production-ui`) — `package.json` now reports `1.7.0`, matching the latest tag.

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
| Phase 7 — Production UI: multi-quotation comparison, 7-step form | `v1.7.0-phase7-production-ui` | ✅ Done |

## Frozen Architecture Components

These are approved and, per working agreement, should not be modified except for a verified bug (see [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for what counts as a documented limitation vs. an actual bug):

- **`parser/`** — the entire Phase 1 extraction surface (all 8 extractors, `lineUtils.js`, `validate.js`, `parseQuotation.js`, `agents.js`). Anything consuming it should only import from `parser/index.js`.
- **`renderer/`** — the entire Phase 2 rendering surface. Consumes only `parseQuotation()`'s output; no parsing logic of its own.
- **`browser-tool/application/submission.js`** — the original Phase 4 submission-object builder, kept unmodified and wrapped (not replaced) by the Phase 5 `models/SubmissionPayload.js`. Phase 7 extended `SubmissionPayload.js` further (employment/family/medicalHistory/bank/documents) entirely additively, still without touching `submission.js`.

Non-frozen, actively evolving surfaces: `browser-tool/app.js`, `browser-tool/index.html`, `browser-tool/pdfTextSource.browser.js`, `browser-tool/application/` (beyond `submission.js`), `browser-tool/destinations/`, `browser-tool/queue/`, `browser-tool/services/`, `browser-tool/models/`, `renderer/renderComparison.js` (new).

## Current Project Status

The tool is feature-complete end to end and is the production entry point (`browser-tool/index.html`): an agent drops 1-3 PruBSN Product Illustration PDFs, reviews and edits any flagged field per quotation (tabbed when more than one), generates client-facing quotation(s) with an automatic comparison view when 2-3 were uploaded, and downloads or prints each as PDF. Each generated quotation carries its own 7-step client application form (matching the official "PruBSN Client Form" template's step set) with a Plan Selection step driven by the agent's real generated quotation(s), not a hardcoded price list. A client who opens the file and applies has their submission (including uploaded ID documents, base64-encoded) durably queued client-side and delivered to a live Airtable Automation webhook, with retry on failure.

Known gaps carried forward from the parser's design (see [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for full detail):

- Verified against exactly **one** real sample PDF (plus the synthetic test fixture); anchors are trusted, not yet re-confirmed, across other ages/genders/plan tiers.
- `validate.js`'s plan-tier/annual-limit cross-check only recognizes "Plan 200".
- Parser anchors and the benefit-label dictionary are specific to PruBSN AnugerahMax + Medic TotalCare — a different product or rider would need its own review.
- **The separate legacy client intake form (`PruBSN Client Form - Standalone updated.html`, outside this repo) still embeds a live, full read/write Airtable Personal Access Token in client-facing HTML** — flagged during Phase 1 planning as a security issue, confirmed still present and exploitable during Phase 7 testing (2026-07-21). The Phase 7 7-step form now fully replaces that file's functionality using the existing secure webhook pattern (`AirtableDestination.js`), but the legacy file itself was intentionally left untouched (it's a self-extracting bundled export, not hand-editable source) rather than risk corrupting it. **Recommended action: stop distributing/using that file, and rotate the embedded Airtable PAT immediately** — anyone who has ever received that file can read/write the entire Airtable base via view-source.
- The Airtable Automation's field mapping (configured in Airtable's own UI, outside this repo) needs updating to receive the Phase 7 payload's new sections (`employment`, `family`, `medicalHistory`, `bank`, `documents`, `selectedPlan`) — the webhook itself needs no code change, but unmapped fields simply won't be written to Airtable until the Automation's mapping is extended.

## Next Development Phase

**Phase 8** (planning) — see [ROADMAP.md](ROADMAP.md) for the full breakdown. Leading candidates:

- Rotate the exposed legacy Airtable token and retire the legacy standalone client form file.
- Multi-agent UI polish: let an agent select/edit the active agent in the browser tool rather than relying on a single hardcoded agent.
- Run the parser against 2–3 additional real client PDFs (different ages, genders, plan tiers) and treat any new failure as a real parser bug.
- Update the Airtable Automation's field mapping for the Phase 7 payload's new sections.
