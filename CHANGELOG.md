# Changelog

All notable changes to this project are documented in this file, derived from the project's tagged releases and git history.

## [Unreleased] — 2026-07-21

**Production stability audit** — an end-to-end pass through the full agent workflow (1, 2, and 3-PDF uploads through to a real Airtable submission), driven with an actual headless browser rather than by reading code, surfaced and fixed several real defects. Not yet tagged.

**Bugs fixed:**
- **Critical: client application submissions were completely non-functional.** `clientRuntime.js` assigned `AirtableDestination.configure({...})`'s return value (`undefined` - `configure()` is a side-effecting call with no `return`) to the destination it hands `SubmissionService.submit()`, so every real submit rejected with `"a destination with a send() function is required."` and the client's UI hung forever on "Submitting Your Application…". Fixed by passing the `AirtableDestination` module itself, and added a regression test that exercises `SubmissionService.submit()` the same way `clientRuntime.js` actually calls it (the existing tests called `AirtableDestination.send()` directly and never caught this).
- `renderer/formatters.js`'s `shortValue()` (used by the medical-card mockup and the Room & Board / key-figure cards) took only the text before the first `(`, so a benefit value with its day-count note written *before* the figure (e.g. the synthetic test fixture's "(maximum 150 days per rider year) RM200 per day") produced an empty string and silently fell back to a "missing" placeholder, even though the exact same value rendered correctly in the benefits table two lines below (via a different helper, `primaryValue`). Fixed to strip parenthetical notes from anywhere in the string, while still correctly returning `null` (not the raw note text) for a value that is *only* a day-count note with no real figure - see `docs/KNOWN_LIMITATIONS.md` item 2.
- `scripts/dev-server.js`: navigating to the server root (`/`) served `index.html`'s bytes without changing the browser's URL there, so its relative asset paths (`vendor/pdf.min.js`, `dist/app.bundle.js`) resolved to the wrong directory and 404'd, leaving a blank page with no visible error. Fixed to redirect `/` to `/browser-tool/index.html`.
- The generated quotation/comparison documents had no `@media print` rules at all: printing/saving as PDF (1) rendered the medical card as a blank box, because its dark background + white text are a CSS background that most browsers omit by default when printing without "background graphics", and (2) could strand the agent/dealership footer alone on an otherwise-blank final page, next to a "Continue Application" button that renders as a dead, greyed-out control on paper. Added print styles: forced color-adjust on the elements whose background carries real information, page-break hints, and hiding of the (meaningless on paper) application CTA/form root in print.
  - A first attempt at the medical card fix disabled the card's decorative 1.4px gradient-ring border (`.medcard::after`, drawn with a `mask-composite` trick) by forcing color-adjust on it too - that mask does not survive Chromium's print rendering at all and painted as a solid, opaque rectangle over the *entire* card, hiding all its text. Fixed by turning the ring off in print instead of forcing it - a fair trade for the card being legible.
- Uploading the same PDF twice (duplicate file, same name+size) silently created two identical review tabs with no indication anything was skipped or should have been. Uploading more files than the 3-quotation cap allows silently dropped the excess with no feedback either. Both now surface a visible notice above the file list.
- The client Review step's "Quotation Summary" section had a field literally labelled "Selected Plan" showing `plan.basicPlanName` (the base life plan, e.g. "PruBSN AnugerahMax (Basic)") - completely unrelated to, and inconsistent with, the *actual* selected plan shown a few lines below under "Plan Selection > Plan" (e.g. "Medic TotalCare Plan 200"). Renamed to "Base Plan" to remove the collision.
- The footer's dealership-details fallback used the generic "missing value" placeholder text ("Refer to certificate") for an agent with no dealership info on file - contextually meaningless for a footer's contact/branding line ("Refer to certificate" makes sense for a benefit figure, not for "we have no address on file"). Fixed `missing()` to render nothing for an explicitly-empty `clientText` rather than coercing it to the generic phrase.
- `browser-tool/models/SubmissionPayload.js` (schema bumped to **v1.2**, additive only): `applicant.race`/`applicant.religion` were collected and validated on the client's Personal Information step, shown on the Review step, but never actually included in the object sent to Airtable. `agent.phone`/`agent.email` were resolved but never forwarded. If a client compared 2-3 quotations and picked one that wasn't the first, only the chosen plan's *name* reached the payload - its price/room & board/annual limit, and the other option(s) shown but not picked, were lost; added `plansCompared` (every option shown) and `selectedPlanDetails` (the chosen option's own numbers, correctly resolved regardless of which one was picked).

**Added:**
- Agent-logo branding: the quotation header now renders an agent's real logo (`agents.js`'s `logo` field) as an `<img>` when one is configured, falling back to the existing generic gold-mark SVG when it isn't (never fabricated) - closing the one feature gap called out in `README.md`'s roadmap section.
- `test/renderer/formatters.test.js`, `test/renderer/agentBranding.test.js` - new test coverage for the renderer, which had none before this audit.
- A regression test in `test/browser-tool/submissionPipeline.test.js` for the Airtable wiring bug above, and new payload-completeness assertions (`race`/`religion`, `plansCompared`, `selectedPlanDetails`, agent `phone`/`email`).

**Files changed:** `browser-tool/app.js`, `browser-tool/application/{clientRuntime,composeClientDocument,buildPrefillData,ReviewPage}.js`, `browser-tool/destinations/AirtableDestination.js`, `browser-tool/models/SubmissionPayload.js`, `browser-tool/index.html`, `renderer/{formatters,renderQuotation}.js`, `scripts/dev-server.js`, `test/browser-tool/submissionPipeline.test.js`. **Files added:** `test/renderer/formatters.test.js`, `test/renderer/agentBranding.test.js`, `docs/AIRTABLE_FIELD_MAPPING.md`.

## [v1.7.0-phase7-production-ui] — 2026-07-21

**feat: production UI rebuild — multi-quotation comparison, 7-step client form, premium browser-tool redesign**

`browser-tool/index.html` becomes the real production quotation generator: a staged Upload → Review → Generate flow, replacing the earlier single-quotation review-form prototype look.

- **Multi-PDF upload (1-3 quotations).** `app.js` now holds an array of independently-parsed quotations; drag-and-drop/file-picker accepts up to 3 PDFs with per-file progress chips, graceful per-file error handling (invalid file type, corrupted/unreadable PDF), and a tabbed review screen (one tab per quotation, each with its own error/warning banner).
- **Automatic comparison.** New `renderer/renderComparison.js` (same client-safety gating as `renderClientQuotationHtml` — no output unless every quotation is error-free and agent-acknowledged) renders a side-by-side key-figures and full benefit-by-benefit comparison table, shown automatically for 2-3 quotations and never shown for 1.
- **Full 7-step client application form**, matching the official "PruBSN Client Form" template's step set and branding: Personal Information, Employment Details, Family Information, Medical History, Plan Selection (+ Beneficiary), Documents Upload, Bank Details. Previously 4 steps (Personal, Address, Employment, Beneficiary).
  - Plan Selection now shows the agent's **real generated quotation(s)** as pickable cards (via `buildPrefillData.js`'s new `plans` array) — never a hardcoded price list.
  - Documents Upload captures NRIC front/rear + selfie client-side, base64-encoded, and included in the submission payload — through the existing secure webhook adapter, never a client-embedded Airtable token (see Security below).
  - `models/SubmissionPayload.js` bumped to schema `1.1`, additively extending `1.0` with `employment`, `family`, `medicalHistory`, `bank`, `documents`, and `selectedPlan`.
- **Print / Save as PDF.** Every generated document (quotation, comparison) can be printed or saved as PDF via the browser's native print dialog, opened in a fresh tab so pagination uses the document's own content rather than an embedded iframe.
- **Premium redesign** of `browser-tool/index.html`: branded header/stepper, hero upload section, tabbed review, comparison + output stage — teal/gold/rose PruBSN identity throughout, matching `medical-card-quotation.html`'s visual language.

**Bugs fixed (found via live-browser testing during this rebuild, not previously exercised):**
- `renderer/renderQuotation.js`: an agent code absent from `agents.js` (e.g. any synthetic/test PDF, or a real not-yet-onboarded agent) caused the "missing data" HTML fallback to be escaped a second time at three template sites, showing clients literal `<span class="na">...</span>` markup instead of styled placeholder text. Fixed by escaping plain-text values and safe-HTML fallbacks exactly once, consistently.
- Removed a dead, never-referenced `planLabel` variable in the same function.
- `ApplicationForm.js`/`clientRuntime.js`: the new Plan Selection card picker's chosen value was being silently overwritten with `''` on every "Next" click, because the generic step-value collector looked for a `[name="plan"]` form input that doesn't exist for a card-picker field. Fixed by excluding `plan-cards` fields from generic collection/validation and validating plan selection explicitly.

**Security:** the legacy `PruBSN Client Form - Standalone updated.html` (outside this repo) still embeds a live, full read/write Airtable Personal Access Token in client-facing HTML — unchanged by this release (see PROJECT_STATUS.md and ROADMAP.md). The new 7-step form fully replaces that file's functionality on the secure webhook pattern; recommend retiring/no longer distributing the legacy file and rotating the exposed token.

**Files changed:** `browser-tool/index.html`, `browser-tool/app.js`, `browser-tool/application/*.js`, `browser-tool/models/SubmissionPayload.js`, `renderer/renderQuotation.js`, `test/browser-tool/submissionPipeline.test.js`. **Files added:** `renderer/renderComparison.js`.

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
