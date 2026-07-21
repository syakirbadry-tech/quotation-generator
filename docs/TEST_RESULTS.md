# Test Results — Phase 1 Parser

**Test harness:** [`quotation-generator/test/run-sample.js`](../test/run-sample.js)
**Run with:** `node test/run-sample.js [path-to-pdf]` (defaults to the sample PDF used throughout Phase 1 development)
**Sample document:** `Santun_Syafitri_Binti_Mulyadi_14072026182021.pdf` — a real 33-page PruBSN AnugerahMax + Medic TotalCare Product Illustration, quotation date 14/07/2026, client: female, non-smoker, age 26 next birthday, Class 2 occupation, Medic TotalCare Plan 200 / SmartSaver300.

**Result (last run):** `40 passed, 0 failed`, exit code `0`. **0 errors.** 5 warnings, all reviewed and confirmed correct (see below) — none indicate a defect.

This is a single-document smoke test, not a unit-test suite with isolated fixtures per extractor. It exercises the full pipeline (`extractPagesFromPdf` → `parseQuotation` → all 8 extractors → `validateQuotation`) end to end and asserts specific values that were independently verified by hand against the source PDF during development. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) item 1 for why more sample documents should be run before this parser is trusted for other clients.

## Assertions (40/40 passed)

| Section | Assertions |
|---|---|
| Metadata | productName, quotationDate.iso, validUntil.iso |
| Client | fullName, gender, smokerStatus, occupationClass, ageNextBirthday, dateOfBirth.iso |
| Agent | agentNameOnDocument, agentCode |
| Plan | basicPlanTerm, basicSumCovered, medicalPlanTier, coPaymentOption, coverageToAge |
| Contributions | isaContribution, medicTotalCareContribution, protectionContribution, wakalahCertificateCharge, totalMonthlyContribution, totalAnnualContribution, guaranteedDeathTPDBenefit, totalContributionOverTerm, nonGuaranteedCashValueScenarioX, nonGuaranteedCashValueScenarioY (added post-Phase-1, for the narrative quotation renderer migration - see CHANGELOG.md) |
| Benefits | annualLimit, lifetimeLimit, benefitItems.length (18), medicalExclusions.length (3), fullExclusionsList.length (28) |
| Options | columns.length (3), each column's annualContribution ([2112, 1860, 2952]), each column's coPaymentOption, coverageTerm |
| Projection | projectionRows.length (5), row[0] full shape, both inflation-assumption percentages (7, 10) |
| Overall | `errors.length === 0` |

## Warnings (5) — all reviewed, none are defects

| Field | Message | Why this is correct, not a bug |
|---|---|---|
| `benefits.benefitItems.Surgical Procedure and Treatment` | No explicit value found; may be a merged table cell | Confirmed against the PDF: this row genuinely shares its "As charged" value with the "In Hospital and Related Services" row. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) item 2. |
| `benefits.benefitItems.Post-Hospitalisation Treatment` | Same | Genuinely shares its value with "Pre-Hospitalisation Treatment". |
| `benefits.benefitItems.Outpatient Kidney Dialysis Treatment` | Same | Genuinely shares its value with "Outpatient Cancer Treatment". |
| `options.productName` | Reconstructed from wrapped/shared table cells, lower confidence | By design — this field always self-flags. Reconstructed values for the sample document (`"PruBSN AnugerahMax: MTC Plan 200"` ×2, `"PruBSN Asas360 6 : Health360 Plan 200"`) match the PDF exactly. |
| `benefits.benefitItems` | Rollup: "2 of 18 benefit items have no value" | `validate.js`'s completeness check counts strictly `value === null` items — that's Surgical Procedure and Treatment, and Outpatient Kidney Dialysis Treatment. Post-Hospitalisation Treatment has a non-null value (the day-count note "(within 120 days immediately after hospitalisation)"), just not a charge amount, so it isn't counted here — but `extractBenefits.js` flags it separately with its own per-item warning (row above the table). All three merged-cell rows are individually warned regardless of which count they show up in. |

## A bug the validation layer itself caught (and its own fix)

During development, `validate.js`'s first draft of the contribution-arithmetic check assumed `isaContribution + medicTotalCareContribution + protectionContribution + wakalahCertificateCharge` should equal `totalMonthlyContribution`. It didn't (5 + 164 + 169 + 7 = 345 ≠ 176), which correctly surfaced as a warning — but investigation showed the extracted *data* was right and the *check* was wrong: `protectionContribution` (169) is a subtotal of `isaContribution + medicTotalCareContribution` (5 + 164 = 169), not a fifth additive term. The real relationship is `isaContribution + medicTotalCareContribution + wakalahCertificateCharge = totalMonthlyContribution` (5 + 164 + 7 = 176 ✓). The check was corrected; see `checkContributionBreakdownSumsToMonthly` in `validate.js` and the corresponding note in [PARSER_API.md](PARSER_API.md) under `data.contributions`.

This is left in here as the concrete example of what "report warnings instead of silently failing" caught during Phase 1 — including a bug in the *validation logic itself*, not just the extraction.

## Recommended before Phase 3 (production browser tool) ships

- [ ] Run against 2-3 more real client PDFs, ideally spanning different ages and, if available, a Platinum/higher room-and-board plan tier
- [ ] Re-verify the layout-dependent techniques in `extractOptions.js` and `extractBenefits.js` once a `pdf.js`-based text source (Phase 3) replaces the `pdftotext` dev backend
- [ ] Extend `KNOWN_PLAN_TIER_ANNUAL_LIMITS` in `validate.js` as other plan tiers are confirmed
