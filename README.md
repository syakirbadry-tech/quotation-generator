# PruBSN Quotation Generator

A modular toolchain that turns a PruBSN AnugerahMax + Medic TotalCare "Product Illustration" PDF into a data-driven client quotation, and carries that quotation through a client-facing application form to a submission destination (Airtable) — without ever running a server.

It replaces the previous manual workflow, where an agent hand-copied numbers out of a 33-page PDF into a bespoke, one-off HTML file per client.

## Overview

The project is built in three layers, each with a hard boundary to the next:

1. **Parser** (`parser/`) — reads PDF text (however it was extracted) and returns structured, validated data. Never renders anything.
2. **Renderer** (`renderer/`) — turns that structured data into the client-facing quotation HTML. Never parses a PDF.
3. **Browser tool** (`browser-tool/`) — a single self-contained HTML page, run entirely client-side, that wires the parser and renderer together behind an agent review UI, then appends a client application flow (personal details → review → submit) to the generated quotation document itself.

Everything runs in the browser or via Node scripts for development — there is no backend server in production use. The generated quotation is a standalone HTML file an agent downloads and sends to a client; when the client opens it and applies, their submission is POSTed to an Airtable Automation webhook.

## Features

- **Anchor-driven PDF parsing** — locates fields by the literal headings/labels PruBSN's PDF generator always prints, not by page number or blind regex search across the document.
- **Never invents data** — a field that can't be confidently located comes back `null` with a warning, not a guess or a copied neighboring value.
- **Cross-field validation** — a dedicated layer checks arithmetic and consistency (e.g. monthly × 12 = annual, plan tier ↔ annual limit) after all extraction is done.
- **Data-driven renderer** — consumes only the parser's `{ data, warnings, errors }` output; no parsing logic of its own.
- **Zero-install browser tool** — a single HTML file (pdf.js vendored, no CDN calls) an agent opens directly: drag-and-drop a PDF, review/edit flagged fields, generate and download the client quotation. No file ever leaves the agent's machine during parsing.
- **In-document client application flow** — the generated quotation itself carries a multi-step "Continue Application" form (personal info, address, employment, beneficiary) that the client fills in when they open the file.
- **Durable, adapter-based submission pipeline** — a localStorage-backed retry queue plus a pluggable destination adapter (Airtable webhook today; console/mock adapters for testing), so a failed submit can be retried without losing the client's answers.
- **No client-facing credential leaks** — the Airtable integration is a scoped webhook-trigger URL configured entirely inside Airtable's own UI, not a base-wide read/write API token embedded in view-sourceable HTML.

## Folder Structure

```
quotation-generator/
├── parser/                  Phase 1 (frozen) — PDF text → structured { data, warnings, errors }
│   ├── lineUtils.js          shared primitives, zero Node dependencies
│   ├── agents.js             AGENTS config (agent contact details, not extraction)
│   ├── extract*.js           8 independent extractor modules (one per section)
│   ├── validate.js           cross-field checks, runs after extraction
│   ├── parseQuotation.js     orchestrator — the only place that composes extractors
│   ├── index.js              public API surface
│   └── pdfTextSource.node.js dev/test-only PDF→text backend (pdftotext)
│
├── renderer/                 Phase 2 (frozen) — structured data → quotation HTML
│   ├── renderQuotation.js
│   ├── formatters.js
│   └── render-sample.js
│
├── browser-tool/             Phase 3–6 — the shipped, self-contained agent tool
│   ├── index.html             agent-facing upload/review/generate UI
│   ├── app.js                  wires parser + renderer + review UI together
│   ├── pdfTextSource.browser.js pdf.js-based text extraction (client-side)
│   ├── application/            client-facing application form + compose-time helpers
│   ├── destinations/            pluggable submission adapters (Airtable, console, mock)
│   ├── models/                  submission payload schema
│   ├── queue/                   durable retry queue (localStorage-backed)
│   ├── services/                submission orchestration
│   ├── vendor/                  vendored pdf.js (no CDN/network dependency)
│   └── dist/                    esbuild output (app.bundle.js, application.bundle.js)
│
├── scripts/                  build-browser-tool.js (esbuild), dev-server.js (local http:// server)
├── test/                     smoke test + unit tests, and a synthetic (fabricated) PDF fixture
├── docs/                     architecture, API reference, known limitations, test results
└── output/                   generated quotations (git-ignored — build artifacts, may contain real client data)
```

## Technology Stack

- **Runtime:** Node.js (development/build scripts and tests), vanilla JavaScript in the browser (no framework) for the shipped tool
- **PDF parsing:** [pdf.js](https://mozilla.github.io/pdf.js/) (vendored, browser) / `pdftotext` (poppler-utils CLI, Node dev/test backend only)
- **Bundling:** [esbuild](https://esbuild.github.io/)
- **Testing:** Node's built-in `assert` module, run as plain scripts (no external test framework)
- **Submission destination:** Airtable, via an Automation "webhook received" trigger (no direct API/token usage from client-facing code)
- **Storage:** `localStorage` (client-side submission retry queue) — degrades gracefully to in-memory when unavailable (e.g. some `file://` contexts)

## Installation

Requires Node.js and, for the parser's Node/test backend only, the `pdftotext` CLI (part of poppler-utils).

```bash
npm install
```

## Usage

### Build the browser tool

Bundles `browser-tool/app.js` and the client-application runtime into `browser-tool/dist/`:

```bash
npm run build:browser-tool
```

### Run the browser tool locally

`browser-tool/index.html` is meant to be opened directly as a local file. For development, a plain HTTP server avoids `file://` CORS restrictions on pdf.js's worker:

```bash
node scripts/dev-server.js
# serves browser-tool/index.html at http://localhost:8347
```

### Run the parser against a sample PDF (Node)

```bash
node test/run-sample.js [path-to-pdf]
```

Defaults to the real sample PDF used throughout Phase 1 development (referenced by absolute path outside the repo — real client PDFs are never committed).

### Render a quotation from parsed data (Node)

```bash
node renderer/render-sample.js
```

### Run the test suite

```bash
node test/run-sample.js
node test/browser-tool/reconstructPageText.test.js
node test/browser-tool/composeClientDocument.test.js
node test/browser-tool/submissionPipeline.test.js
```

## Architecture

```mermaid
flowchart TD
    PDF[PruBSN Product Illustration PDF]

    subgraph Parser["parser/ (frozen — Phase 1)"]
        Text["pages: string[]"]
        Doc["buildDocument() → doc.allLines"]
        Extractors["8 independent extractors\n(metadata, client, agent, plan,\ncontributions, benefits, options, projection)"]
        Validate["validate.js — cross-field checks"]
        Result["{ data, warnings, errors }"]
    end

    subgraph Renderer["renderer/ (frozen — Phase 2)"]
        Render["renderQuotation(data)"]
    end

    subgraph BrowserTool["browser-tool/ (Phase 3–6)"]
        Upload["Upload PDF (drag & drop)"]
        PdfJs["pdf.js text extraction\n(pdfTextSource.browser.js)"]
        Review["Agent review UI\n(edit flagged fields)"]
        Compose["composeClientDocument.js\nappends client application flow"]
        Download["Download client quotation HTML"]
    end

    subgraph ClientDoc["Generated client quotation (opened by client)"]
        AppForm["Application form\n(personal info, address, employment, beneficiary)"]
        Payload["buildSubmissionPayload()"]
        Queue["SubmissionQueue\n(localStorage retry queue)"]
        Service["SubmissionService"]
        Adapter["AirtableDestination\n(webhook adapter)"]
    end

    Airtable[(Airtable Automation\n\"When webhook received\")]

    PDF --> Upload --> PdfJs --> Text --> Doc --> Extractors --> Validate --> Result
    Result --> Review --> Render --> Compose --> Download
    Download --> AppForm --> Payload --> Service
    Service --> Queue
    Service --> Adapter --> Airtable
```

Full design rationale lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Known, by-design gaps and honest limitations are tracked in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). The parser's full field-by-field API is documented in [docs/PARSER_API.md](docs/PARSER_API.md).

## Version History

See [CHANGELOG.md](CHANGELOG.md) for full release notes. Summary:

| Version | Tag | What shipped |
|---|---|---|
| 1.0 | `v1.0-phase1-parser` | PDF parser: 8 extractors, validation layer, `agents.js` config, Node test harness |
| 1.1 | `v1.1-phase2-renderer` | Data-driven quotation renderer; project docs (`ARCHITECTURE.md`, `PARSER_API.md`, etc.) |
| 1.2 | `v1.2-phase3-browser-tool` | Self-contained browser tool: upload → parse → review → generate → download |
| 1.2.1 | `v1.2.1-browser-real-pdf-fix` | Fixed real-PDF extraction bugs (faux-bold duplication, whitespace-width, column-gap miscount) |
| 1.5.0 | `v1.5.0-mvp` | Client application form (Phase 4) + durable submission pipeline (Phase 5) |
| 1.6.0 | `v1.6.0-phase6-airtable` | Live Airtable submission destination wired into the client runtime |

## Roadmap

See [ROADMAP.md](ROADMAP.md) for what's next. In short: closing out the deferred security fix for the legacy client intake form, multi-agent UI polish, broader real-PDF/product-tier verification, and submission-pipeline observability.
