# Roadmap

This roadmap covers planned work beyond the current release (`v1.7.0-phase7-production-ui`). For completed phases, see [PROJECT_STATUS.md](PROJECT_STATUS.md) and [CHANGELOG.md](CHANGELOG.md). For the original phase-by-phase plan drafted during Phase 1–2, see [docs/ROADMAP.md](docs/ROADMAP.md).

## Phase 7 — Production UI: multi-quotation comparison, 7-step client form ✅ Done (`v1.7.0-phase7-production-ui`)

`browser-tool/index.html` is now the production entry point: 1-3 PDF upload, tabbed agent review, automatic comparison for 2-3 quotations, a full 7-step client application form matching the official template, print/PDF export, and premium branded styling throughout. See [CHANGELOG.md](CHANGELOG.md) for the full breakdown.

## Phase 8 — Security fix and multi-agent polish

- **Rotate the exposed legacy Airtable token and retire the legacy intake form.** `PruBSN Client Form - Standalone updated.html` (a sibling file outside this repo) POSTs directly to the Airtable API from the browser with a live, full read/write Personal Access Token embedded in the page source — confirmed still present and exploitable as of 2026-07-21. It was intentionally left unedited during Phase 7 (a self-extracting bundled export, not hand-editable source) since the new 7-step form in this repo now fully replaces its functionality on the secure webhook pattern (`browser-tool/destinations/AirtableDestination.js`). Rotate the token in Airtable's UI and stop distributing the legacy file.
- **Update the Airtable Automation's field mapping** for the Phase 7 payload's additive sections (`employment`, `family`, `medicalHistory`, `bank`, `documents`, `selectedPlan`) so they're actually written to Airtable, not just POSTed and ignored.
- **Multi-agent UI.** Add a UI for selecting/editing the active agent in the browser tool, backed by the existing `AGENTS` config in `parser/agents.js`, instead of a single hardcoded agent.
- **Extend plan-tier validation.** `validate.js`'s `KNOWN_PLAN_TIER_ANNUAL_LIMITS` currently has one entry ("Plan 200"). Extend it as quotations for other plan tiers are seen, so the cross-check stops reporting "unrecognized tier" for valid data.

## Phase 9 — Broader parser and product coverage

- **Verify against more real PDFs.** The parser has been verified against exactly one real sample PDF. Run it against 2–3 more real client quotations spanning different ages, genders, and (if available) a higher room-and-board plan tier; treat any new failure as a real parser bug, per the Phase 1 freeze agreement's one documented exception.
- **Re-verify layout-dependent extraction techniques against production pdf.js output.** The "widest gap = column boundary" and column-offset-calibration techniques in `extractOptions.js`, and the merged-cell handling in `extractBenefits.js`, were built and tuned against `pdftotext` output and later patched for real pdf.js quirks (see `v1.2.1-browser-real-pdf-fix`). Continue re-verifying as more real PDFs are run through the browser path.
- **Support for additional PruBSN products.** Parser anchors and the `BENEFIT_LABEL_DICTIONARY` are specific to AnugerahMax + Medic TotalCare at the SmartSaver co-payment structure. A different product line (e.g. a pure investment-linked plan, or a different medical rider such as Medic BoostCare) would need its own anchor/dictionary review before being trusted.

## Phase 10 — Submission pipeline maturity

- **Submission observability.** The Airtable webhook adapter and the localStorage retry queue currently have no agent- or admin-facing visibility beyond the client's own browser session. Consider a lightweight way for an agent to confirm a client's submission actually arrived (e.g. surfacing the Airtable-side reference more visibly, or a status check).
- **Broaden destination options.** The adapter interface (`{ name, send(payload) }`) already supports swapping destinations without touching the UI or submission service — a second real destination (e.g. email fallback, a different CRM) would validate that boundary further.
- **Payload/version hygiene.** `models/SubmissionPayload.js` tracks `parserVersion`/`rendererVersion` as hand-maintained constants pinned to git tags, since neither frozen module exports a version. Revisit whether this should become a small, explicitly-scoped exception to the freeze (a version export) as more releases accumulate.

## Long-Term Vision

Fully retire the manual, per-client quotation workflow for PruBSN agents: any agent should be able to go from a system-generated PDF to a submitted, tracked client application without leaving the browser, without a backend server to operate, and without any client-facing credential ever being exposed. Longer-term, that means:

- Extending coverage beyond AnugerahMax + Medic TotalCare to other PruBSN Takaful products, following the same anchor-driven, never-invent-data parsing philosophy established in Phase 1.
- Keeping the "no server, no exposed credentials" constraint intact as more destinations and integrations are added — every new integration should default to the scoped-webhook pattern proven out in Phase 6, not a client-embedded API key.
- Treating the Phase 1 freeze model (frozen core, additive layers on top, changes only for verified bugs) as the template for how future frozen surfaces (renderer, submission payload schema) mature over time.
