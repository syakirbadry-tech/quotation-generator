# Phase 1 Summary — PruBSN Quotation PDF Parser

**Status:** Approved and frozen by agreement on 2026-07-20. Not to be modified except for a verified bug — see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for what "verified bug" excludes (documented, by-design behavior is not a bug).

**Note on "frozen":** this freeze is a working agreement, not a git-enforced one — this directory has no git history. If a version-controlled rollback point is wanted later, that still needs to be set up separately.

## What this phase built

A **modular, text-anchor-driven parser** that turns a PruBSN AnugerahMax + Medic TotalCare "Product Illustration" PDF (the official, system-generated quotation PruBSN issues per client) into structured JSON. It replaces the previous manual workflow, where an agent hand-copied numbers out of the 33-page PDF into a bespoke, one-off HTML file per client.

The parser does **not** produce a quotation document — that's Phase 2. Phase 1's job ends at `{ data, warnings, errors }`.

## Why this shape

Every quotation PruBSN generates for this product uses the same fixed headings, labels, and section order (confirmed against the one sample PDF exercised so far — see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for the single-sample caveat). That means fields can be located reliably by **anchor text** (a heading or label PruBSN always prints) rather than by page number or fragile page-image parsing. Regex is used only to clean up a value once it's been located, not to search for it blindly — this was a hard requirement going into the build, because blind pattern-matching across a 33-page insurance document is exactly how a parser quietly returns wrong numbers.

## What was delivered

- 8 independent extractor modules (one per logical section of the quotation: metadata, client, agent, plan, contributions, benefits, options, projection)
- A shared low-level utilities module (`lineUtils.js`) with zero Node-specific dependencies, so it can be reused unchanged by a future browser build
- A cross-field validation layer (`validate.js`) that catches arithmetic and consistency problems no single extractor can see on its own
- An orchestrator (`parseQuotation.js`) that runs all 8 extractors defensively and assembles the final result
- An `AGENTS` configuration object (`agents.js`), separate from the parser, so onboarding a new agent is a config change, not a code change
- A Node-only test backend (`pdftotext`-based) and a smoke test that runs the whole pipeline against a real client PDF

See [PARSER_API.md](PARSER_API.md) for the full field-by-field reference, [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together, [TEST_RESULTS.md](TEST_RESULTS.md) for what was actually verified, and [ROADMAP.md](ROADMAP.md) for what comes next.

## Explicitly out of scope for Phase 1

- Rendering a quotation document (Phase 2)
- Ingesting a PDF inside a browser (Phase 3 — Phase 1's PDF-to-text step is a Node/`pdftotext` dev backend only)
- The Airtable API token exposed in the separate client intake form (tracked as its own fix, not part of this parser)
- PDF export of the generated quotation (the approved design is HTML-only)
