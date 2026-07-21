# Parser API Reference

Code lives in [`quotation-generator/parser/`](../parser/). This is the frozen Phase 1 surface — anything consuming it (the Phase 2 renderer included) should only import from `parser/index.js`.

## Entry point

```js
const { parseQuotation, AGENTS, getAgentConfig } = require('./quotation-generator/parser');

const result = parseQuotation(pages, options);
// result = { data, warnings, errors }
```

### `parseQuotation(pages, options?)`

| Param | Type | Description |
|---|---|---|
| `pages` | `string[]` | One string of extracted text per PDF page, in order. Any text-extraction backend can supply this (see [ARCHITECTURE.md](ARCHITECTURE.md) for the swappable-backend design). |
| `options.sourceFileName` | `string` | Optional, echoed into `data.metadata.sourceFileName` for audit trail. |
| `options.validityDays` | `number` | Optional, default `14`. How many days after `quotationDate` the generated `validUntil` should be. |
| `options.quotationNumber` | `string` | Optional. An agent-assigned quotation number, if one has already been decided. Never invented by the parser — see `metadata.quotationNumber` below. |

**Returns** `{ data, warnings, errors }`:

- `data` — the structured quotation, one key per section (`metadata`, `client`, `agent`, `plan`, `contributions`, `benefits`, `options`, `projection`). A section can be `null` if its extractor threw (see `errors`).
- `warnings` — `{ field, message }[]`. Data was extracted but looks incomplete, ambiguous, or inconsistent. Safe to render, but the agent should be able to see and edit the flagged field.
- `errors` — `{ field, message }[]`. A field the approved extraction model marked **Required** is missing, or an extractor section failed outright. A renderer should treat these as "this quotation cannot be sent as-is."

## Data shape

Types marked **(generated)** are not read from the PDF at all — see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

### `data.metadata`

| Field | Type | Notes |
|---|---|---|
| `productName` | `string \| null` | e.g. `"PruBSN AnugerahMax"` |
| `quotationDate` | `{raw, iso} \| null` | PDF's own print date |
| `quotationVersion` | `string \| null` | PruBSN's internal PDF version string |
| `symcode` | `string \| null` | |
| `pageCount` | `number` | |
| `sourceFileName` | `string \| null` | From `options.sourceFileName`, not the PDF |
| `quotationNumber` | `{value, generated: true, note}` | **(generated)** — `value` is `null` unless passed in via `options.quotationNumber` |
| `validUntil` | `{iso, generated: true, basis} \| null` | **(generated)** — `quotationDate + validityDays` |

### `data.client`

| Field | Type |
|---|---|
| `fullName` | `string \| null` |
| `gender` | `"Male" \| "Female" \| null` |
| `smokerStatus` | `string \| null` (e.g. `"Non-Smoker"`) |
| `occupationClass` | `string \| null` (e.g. `"Class 2"`) |
| `ageNextBirthday` | `number \| null` |
| `dateOfBirth` | `{raw, iso} \| null` |
| `businessProposal` | `boolean \| null` |
| `takafulPlanPurpose` | `string \| null` |

### `data.agent`

| Field | Type | Notes |
|---|---|---|
| `agentNameOnDocument` | `string \| null` | As printed on the PDF |
| `agentCode` | `string \| null` | e.g. `"8LT00006"` — **the only thing the renderer should key off of.** Everything else about the agent (agency, branch, phone, WhatsApp, email, logo, photo) comes from `getAgentConfig(agentCode)`, never from this object. |

### `data.plan`

| Field | Type |
|---|---|
| `typeOfProduct` | `string \| null` |
| `paymentMode` | `string \| null` |
| `basicPlanName` | `string \| null` |
| `basicPlanTerm` | `number \| null` (years) |
| `basicSumCovered` | `number \| null` (RM) |
| `medicalRiderName` | `string \| null` |
| `medicalPlanTier` | `string \| null` (e.g. `"Plan 200"`) |
| `coPaymentOption` | `string \| null` (e.g. `"SmartSaver300"`) |
| `medicalRiderTerm` | `number \| null` (years) |
| `coverageToAge` | `number \| null` | Extracted from "Until age N" wording; if absent, `parseQuotation` fills it in as `ageNextBirthday + basicPlanTerm` and adds a warning noting it was derived, not read. |

### `data.contributions`

All monetary fields are `number \| null` (RM).

| Field | Meaning |
|---|---|
| `isaContribution` | Individual Special Account contribution |
| `medicTotalCareContribution` | Medic TotalCare rider contribution |
| `protectionContribution` | Subtotal = `isaContribution + medicTotalCareContribution` (see [ARCHITECTURE.md](ARCHITECTURE.md) for why this isn't a fifth additive term) |
| `wakalahCertificateCharge` | |
| `totalMonthlyContribution` | = `isaContribution + medicTotalCareContribution + wakalahCertificateCharge` |
| `totalAnnualContribution` | = `totalMonthlyContribution × 12` |
| `totalContributionOverTerm` | Total over the full certificate term (e.g. `RM 2,112 x 44 Years = RM 92,928`) |
| `totalDirectCommission` | |
| `guaranteedDeathTPDBenefit` | |
| `nonGuaranteedCashValueScenarioX` | ISA/IUA cash value at maturity under the PDF's own "Scenario X" hypothetical (2% p.a. investment return) - illustrative, not guaranteed |
| `nonGuaranteedCashValueScenarioY` | Same, under "Scenario Y" (5% p.a.) |

### `data.benefits`

| Field | Type |
|---|---|
| `annualLimit` | `string \| null` (e.g. `"RM200,000"`) |
| `lifetimeLimit` | `string \| null` (e.g. `"No Lifetime Limit"`) |
| `benefitItems` | `{ section, label, value: string \| null }[]` — 18 fixed items across 5 sections. `value` can legitimately be `null` for a merged table cell — see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). |
| `medicalExclusions` | `string[]` — short client-facing exclusions list (from the Medic TotalCare PDS "What is not covered?" column) |
| `fullExclusionsList` | `{ marker, text }[]` — the full lettered (a)–(ab) exclusions list. Optional field. |
| `waitingPeriods` | `{ days, description }[]` — best-effort. Optional field. |

### `data.options`

| Field | Type |
|---|---|
| `columns` | Array of exactly 3: `{ optionLabel, productName, annualContribution, facilityType, coPaymentOption, roomAndBoard, hospitalTreatment, annualLimitOption, lifetimeLimitOption }`, in table order (`"Recommended Product"`, `"Option 1"`, `"Option 2"`) |
| `coverageTerm` | `string \| null` (e.g. `"Until age 70"`) — one shared value for the whole table, not per-column |
| `coverageTermAgesFound` | `string[]` — every distinct "Until age N" occurrence found in the table, for diagnostics |

`columns[].productName` is explicitly lower-confidence — always accompanied by a warning. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

### `data.projection`

| Field | Type |
|---|---|
| `projectionRows` | `{ age, currentContribution, projected7pct, projected10pct }[]` — `projected7pct`/`projected10pct` are `null` for the client's current age (the PDF doesn't project an increase for year zero) |
| `medicalInflationAssumptionLow` | `number \| null` (e.g. `7`) |
| `medicalInflationAssumptionHigh` | `number \| null` (e.g. `10`) |

## Agent configuration

```js
const { AGENTS, getAgentConfig } = require('./quotation-generator/parser/agents');

getAgentConfig('8LT00006');
// => { name, agency, branch, location, phone, whatsapp, email, logo, photo }
// or null if the code isn't configured
```

`AGENTS` is a plain object keyed by agent code, in [`agents.js`](../parser/agents.js). Onboarding a new agent means adding an entry there — never editing a parser file. Unfilled contact fields are empty strings (`''`), never a fabricated placeholder.

## Dev/test-only PDF text source

```js
const { extractPagesFromPdf } = require('./quotation-generator/parser/pdfTextSource.node.js');
const pages = extractPagesFromPdf('/path/to/quotation.pdf'); // requires the `pdftotext` CLI
```

This is **not** part of the frozen parser surface and is **not** what Phase 3's browser tool will use. It exists solely so `parseQuotation()` can be exercised and tested from the command line. See [ROADMAP.md](ROADMAP.md) Phase 3.
