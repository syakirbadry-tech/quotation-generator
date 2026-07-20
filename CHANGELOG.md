# Changelog

All notable changes to this project are documented in this file, derived from the project's tagged releases and git history.

## [v1.6.0-phase6-airtable] — 2026-07-20

**feat: integrate Airtable submission destination**

- Wired a live Airtable Automation webhook into `clientRuntime.js` as the active submission destination (`AirtableDestination.configure({ webhookUrl })`), replacing the mock/console destinations used during Phase 5 development.
- Extended `SubmissionPayload` with additional fields to support the live integration.
- Added regression coverage in `test/browser-tool/submissionPipeline.test.js` for the now-active Airtable path.
- Submission still POSTs to a scoped Airtable Automation "webhook received" trigger, not a base-wide API token — see `browser-tool/destinations/AirtableDestination.js` for the security rationale.

**Files changed:** `browser-tool/application/clientRuntime.js`, `browser-tool/models/SubmissionPayload.js`, `browser-tool/dist/app.bundle.js`, `browser-tool/dist/application.bundle.js`, `test/browser-tool/submissionPipeline.test.js`

## [v1.5.0-mvp] — 2026-07-20

**feat: complete Phase 4 client workflow and Phase 5 submission pipeline**

Phase 4 — Client application workflow:
- Added a multi-step client application form appended to the generated quotation document itself: Personal Information, Address, Employment, and Beneficiary steps (`browser-tool/application/ApplicationForm.js`), each with field-level validation (`validation.js`).
- Added a review step (`ReviewPage.js`) and a confirmation step (`ConfirmationPage.js`).
- Added `composeClientDocument.js`, which string-appends the client application flow onto the frozen renderer's HTML output without ever modifying the renderer's own markup.
- Added `buildPrefillData.js`, an explicit allowlist that exposes only quotation/agent/client summary fields to the client-runtime bundle — never raw parser internals (agent codes, full benefit tables, warnings).
- Added `clientRuntime.js` as the client-runtime bundle entry point, injected into the generated document as an inlined `<script>` via a second esbuild bundle stage (`scripts/build-browser-tool.js`).

Phase 5 — Submission pipeline:
- Added `models/SubmissionPayload.js`, a versioned submission envelope (`{ version, quotation, agent, applicant, beneficiaries, metadata }`) built on top of the Phase 4 `submission.js` shape.
- Added `services/SubmissionService.js`, orchestrating submission attempts against an injected destination adapter; `submit()` never throws — every outcome resolves to a typed `{ status, ... }` result.
- Added `queue/SubmissionQueue.js`, a `localStorage`-backed durable queue so a failed submission survives a page refresh and can be retried, with in-memory fallback when storage is unavailable.
- Added a generic destination adapter interface with `ConsoleDestination.js` and `MockDestination.js` implementations, plus a first cut of `AirtableDestination.js` (not yet activated — see v1.6.0).
- Added `test/browser-tool/composeClientDocument.test.js` and `test/browser-tool/submissionPipeline.test.js`.

**Files changed:** 21 files, +2766/-3 lines, entirely additive to `browser-tool/application/`, `browser-tool/destinations/`, `browser-tool/models/`, `browser-tool/queue/`, `browser-tool/services/`.

## [v1.2.1-browser-real-pdf-fix] — 2026-07-20

**Fix browser-real-PDF extraction bugs: faux-bold duplication, phantom whitespace width, borderline column-gap miscount**

PruBSN's own generated PDF (unlike the Chrome print-to-PDF used for the synthetic test fixture) simulates bold text by drawing the same run twice (some elements 4×) at the identical position, which pdf.js reports as byte-identical overlapping text items. Concatenating them verbatim corrupted the client name, broke the agent footer anchor, and blanked required fields.

- Added `dedupeOverlappingFragments()` to collapse exact `(text, x, y)` duplicates before any spacing/concatenation logic runs.
- Stopped trusting a whitespace fragment's own reported width; all spacing is now computed from real (non-whitespace) fragment-to-fragment gaps.
- Recalibrated `SPACE_WIDTH_RATIO` from `0.28` to `0.35` against a measured real single-space gap (3.96pt at 8.25pt font) from the source PDF, fixing a borderline single-space gap that was misclassified as a table-column break.
- Pre-filled the 3 known-merged benefit table cells (Surgical Procedure and Treatment / Post-Hospitalisation Treatment / Outpatient Kidney Dialysis Treatment) in the browser-tool review UI with their visually-verified values — shown as an editable suggestion, not a parser change.
- Added `test/browser-tool/reconstructPageText.test.js`, a unit-level regression suite reproducing all 4 bug patterns from fabricated pdf.js-shaped data (no PDF file or real client data required).
- Verified: the real sample PDF through the actual browser upload flow now matches the Node/`pdftotext` baseline exactly (0 errors, same 5 warnings, identical field values). `parser/` and `renderer/` confirmed byte-identical to their frozen tags — all fixes scoped to `browser-tool/`.

**Files changed:** `browser-tool/app.js`, `browser-tool/dist/app.bundle.js`, `browser-tool/pdfTextSource.browser.js`, `test/browser-tool/reconstructPageText.test.js` — 305 insertions, 37 deletions.

## [v1.2-phase3-browser-tool] — 2026-07-20

**Phase 3: Add browser-based quotation generator tool**

Self-contained browser tool (pdf.js, vendored, no CDN/network calls) that wires the frozen parser and Phase 2 renderer behind an agent review UI: upload → local PDF parsing → editable review screen with inline warnings → explicit confirm-review gate → client-safe HTML generation → download.

- Added `browser-tool/index.html`, `browser-tool/app.js`, `browser-tool/pdfTextSource.browser.js`.
- Vendored pdf.js (`browser-tool/vendor/pdf.min.js`, `pdf.worker.min.js`, license) so the tool makes no network calls.
- Added `scripts/build-browser-tool.js` (esbuild bundling) and `scripts/dev-server.js` (local dev server, avoids `file://` CORS restrictions on the pdf.js worker).
- Added a synthetic, fabricated-data sample PDF fixture (`test/fixtures/synthetic-quotation.pdf` / `.html`) for safe end-to-end testing with no real client data.
- Added `package.json` / `package-lock.json` (esbuild, pdfjs-dist as dev dependencies).

**Files changed:** 15 files, +4929 lines.

## [v1.1-phase2-renderer] — 2026-07-20

**Phase 2: Add data-driven quotation renderer**

- Added `renderer/renderQuotation.js`, `renderer/formatters.js`, `renderer/render-sample.js` — consumes only `parseQuotation()`'s output, with no PDF-parsing logic of its own.
- Reused the existing quotation HTML/CSS design as the template; hardcoded values became data-driven fields.
- Added project documentation: `docs/ARCHITECTURE.md`, `docs/PARSER_API.md`, `docs/PHASE1_SUMMARY.md`, `docs/ROADMAP.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/TEST_RESULTS.md`.
- Added `.gitignore` covering generated output, real client PDFs, and other client-data artifacts.

**Files changed:** 10 files, +1151 lines.

## [v1.0-phase1-parser] — 2026-07-19

**Phase 1: Complete PDF parser with validation and tests**

- Added 8 independent extractor modules — `extractMetadata`, `extractClient`, `extractAgent`, `extractPlan`, `extractContributions`, `extractBenefits`, `extractOptions`, `extractProjection` — each taking a page-agnostic document view and returning its section plus warnings.
- Added `lineUtils.js`, shared low-level line/text primitives with zero Node dependencies (so it can be reused unchanged by a future browser build).
- Added `validate.js`, a cross-field validation layer that runs after all extraction completes.
- Added `parseQuotation.js`, the orchestrator that runs all 8 extractors defensively (one section's failure doesn't abort the rest) and assembles `{ data, warnings, errors }`.
- Added `agents.js`, an `AGENTS` configuration object separate from parsing logic, so onboarding a new agent is a config change, not a code change.
- Added `pdfTextSource.node.js`, a dev/test-only `pdftotext`-based PDF text backend, and `test/run-sample.js`, a smoke test exercising the full pipeline against a real client PDF (37 assertions, 0 errors, 5 reviewed-and-confirmed warnings).

**Files changed:** 15 files, +2122 lines.
