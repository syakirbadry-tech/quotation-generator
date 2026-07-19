# Architecture

## Design principles (these drove every decision in Phase 1)

1. **Locate by anchor, clean with regex.** Every extractor finds data by searching for a literal heading or label PruBSN's PDF generator always prints (an "anchor"). Regular expressions are used only to clean up the value once it's been found (strip "RM", pull an integer out of "26 next birthday", split a trailing agent code) — never to search blindly for a pattern across the document.
2. **No page-number dependence.** Sections are located by heading/label text via `doc.allLines`, a flat, page-number-agnostic view of the whole document. A section can span a page break without special-casing.
3. **Never invent data.** When a value can't be confidently located (a merged PDF table cell, an ambiguous multi-line wrap), the extractor returns `null` and records a warning — it does not guess, copy a neighboring value, or fall back to a plausible-looking default. The one exception (`plan.coverageToAge`'s derived fallback) is implemented outside any extractor, in the orchestrator, specifically so it's visible and separately warned about rather than silently blended into "what the PDF said."
4. **One extractor per logical section, no monolith.** `extractMetadata`, `extractClient`, `extractAgent`, `extractPlan`, `extractContributions`, `extractBenefits`, `extractOptions`, `extractProjection` are independent modules. Each can be read, tested, and reasoned about without the others.
5. **Parsing and configuration are separate.** The parser extracts `agentCode` and stops. Everything else about an agent (agency, branch, contact details) lives in `agents.js`, a plain config object, keyed by that code. This was a hard requirement so that onboarding a new agent never means touching parser code.
6. **Validation is a separate layer, after extraction.** No extractor cross-checks another extractor's output. `validate.js` runs once, after all 8 extractors have produced their section, and only does checks that genuinely require more than one section's data (monthly × 12 = annual, plan tier ↔ annual limit, required-field presence across the whole document).

## Module map

```
quotation-generator/parser/
├── lineUtils.js          shared primitives — zero Node dependencies
├── agents.js              AGENTS config (NOT extraction)
├── extractMetadata.js  ┐
├── extractClient.js     │
├── extractAgent.js      │  8 independent extractors,
├── extractPlan.js        │  each takes `doc` and returns
├── extractContributions.js│ { ...fields, _warnings }
├── extractBenefits.js    │
├── extractOptions.js     │
├── extractProjection.js ┘
├── validate.js            cross-field checks, runs after extraction
├── parseQuotation.js       orchestrator — the only place that composes
│                           the above into { data, warnings, errors }
├── index.js                public API surface
└── pdfTextSource.node.js  dev/test-only PDF→text backend (see below)
```

## Data flow

```
PDF file
   │
   │  (Phase 1 dev/test: pdfTextSource.node.js, via `pdftotext -layout`)
   │  (Phase 3 production: a pdf.js-based equivalent — not built yet)
   ▼
pages: string[]                      one string per PDF page
   │
   ▼
buildDocument(pages)                  lineUtils.js
   │
   ▼
doc = { pageCount, pages, allLines }  flat, page-number-agnostic line list
   │
   ├──► extractMetadata(doc)   ─┐
   ├──► extractClient(doc)      │
   ├──► extractAgent(doc)       │  each independent, each wrapped in
   ├──► extractPlan(doc)        │  parseQuotation's safeExtract() so one
   ├──► extractContributions(doc)  section's failure doesn't abort the rest
   ├──► extractBenefits(doc)    │
   ├──► extractOptions(doc)     │
   └──► extractProjection(doc) ─┘
   │
   ▼
data = { metadata, client, agent, plan, contributions, benefits, options, projection }
   │
   ├─ one derived fallback: plan.coverageToAge, if not found in the PDF,
   │  is filled in as client.ageNextBirthday + plan.basicPlanTerm (warned)
   │
   ▼
validateQuotation(data)               validate.js — cross-field checks
   │
   ▼
{ data, warnings, errors }            parseQuotation()'s return value
   │
   ▼
 ── Phase 1 ends here ──
   │
   ▼
(Phase 2) renderer                    consumes `data` only, no parsing logic
   │
   ▼
Quotation HTML
```

## Why `pdftotext` today, `pdf.js` later

Every extractor and `lineUtils.js` operates on `pages: string[]` — plain strings, one per page — and has no idea whether those strings came from a CLI tool or a browser library. `pdfTextSource.node.js` is the only file that knows about `pdftotext`, and it's not imported by anything except the test harness. This means Phase 3 can introduce a `pdf.js`-based text source for the browser tool without touching a single extractor — as long as the new source produces layout-preserving text with the same general properties (columns separated by run-length whitespace, page breaks as array boundaries) that the current extractors were built and tested against. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) item 7 for what to re-verify when that swap happens.

## Two recurring PDF-layout quirks the parser works around

PruBSN's PDF generator centers a value between the two lines of a wrapped label, rather than printing "label, then value" in a clean top-to-bottom order. Two general-purpose techniques in `lineUtils.js` handle this without hardcoding per-field positions:

- **`boundedValueForLabel`** — for a table row, take everything in a label-bounded slice of lines *except* the label text itself; whatever's left is the value, regardless of which line it physically sits on.
- **`splitTwoColumnByHeader`** (and the offset-calibration variant built directly into `extractOptions.js` for its 3-column table) — when two columns of text are interleaved row-by-row by the layout-preserving text extraction, calibrate the column boundary once from a header row that's known to belong to exactly one column, then classify every other line's fragments by which calibrated offset they're closest to.

Both techniques are documented in-place with comments explaining the "why," since they're the least obvious part of the codebase to a future reader.
