# Airtable Field Mapping — Clients Table

**Base:** `appcA4lwc8KrLNxwM` (the base the live webhook in `browser-tool/application/clientRuntime.js` already points at)
**Table:** `Clients` (`tblmBQko8J7yOsBbv`) — **the single source of truth for one customer's application.** Every section of the client-facing application form maps onto this one table; nothing is split across tables. The base's other table, `Applications` (`tblXqOyu2djDBfFuJ`), is a legacy, effectively-empty table (3 blank test records, no working field mapping) and is **deprecated** — see [Deprecating the Applications table](#deprecating-the-applications-table).

This document maps every field the client-runtime webhook payload (`browser-tool/models/SubmissionPayload.js`, schema **v1.2**) sends to a specific `Clients` column, so the Airtable Automation's "Create record" (or "Run script") action can be configured to write every collected field, with nothing silently discarded.

The `Clients` table schema below already exists in the live base as of 2026-07-21 — 23 new fields were added and one legacy field renamed/deprecated to support this mapping (see [Schema changes made](#schema-changes-made-2026-07-21)). **The one thing this document cannot do is reconfigure the Automation's action itself** — Airtable Automation step configuration lives entirely inside Airtable's own UI and isn't reachable through this project's API/MCP access (see `browser-tool/destinations/AirtableDestination.js`'s header comment for why that boundary is deliberate). Use the tables below to wire it up by hand.

## Payload shape (v1.2)

```
{
  version: "1.2",
  quotation: { quotationNumber, validUntil, validUntilIso, planName, monthlyContribution, riders: [] },
  plansCompared: [ { planName, monthlyContribution, roomAndBoard, annualLimit }, ... ],  // 1-3 entries
  selectedPlan: "string | null",                     // the plan name the client picked
  selectedPlanDetails: { planName, monthlyContribution, roomAndBoard, annualLimit } | { planName } | null,
  agent: { name?, agency?, branch?, phone?, email? }, // each key present only if known
  applicant: {
    fullName, nric, dateOfBirth, gender, race, religion, mobileNumber, email, address,
    postcode, city, state,      // always "" under the current 7-step form - see note below
    occupation, employer, annualIncome, // employer/annualIncome always "" - superseded by employment.*
  },
  beneficiaries: [ { name, relationship, percentage, nric } ],  // 0 or 1 entries
  employment: { employmentType, fieldOfWork, employerName, workAddress, monthlyIncome },
  family: { maritalStatus, spouseName, spouseNric, numChildren, childrenDetails },
  medicalHistory: { height, weight, smokingStatus, preExistingConditions, currentMedications, allergies, previousSurgeryOrHospitalisation },
  bank: { bankName, accountNumber, accountHolderName },
  documents: { nricFront?, nricRear?, selfie? },      // each { filename, mimeType, base64 }
  metadata: { submissionId, quotationId, parserVersion, rendererVersion, generatedAt, submittedAt, product, source }
}
```

`applicant.postcode`/`city`/`state`/`employer`/`annualIncome` are artifacts of the frozen Phase 4 `submission.js` shape (see [PARSER_API.md](PARSER_API.md)'s sibling docs for the freeze policy) that the current 7-step form no longer collects — they will always be empty strings and are safe to leave unmapped. `employment.employerName`/`employment.monthlyIncome` are their real, current-form replacements.

## Field mapping — by section

### Personal Information

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `applicant.fullName` | Full Name | `fldN3ftmTFSsIPi7a` | singleLineText | primary field |
| `applicant.nric` | NRIC | `fldjKjZq6ANCGA1jU` | singleLineText | |
| `applicant.dateOfBirth` | Date of Birth | `fldAUK59Mv1MvchvX` | date | payload sends `YYYY-MM-DD` |
| `applicant.gender` | Gender | `fldCOE0dXA8K0i6bi` | singleSelect | choices `Male`, `Female` — matches form exactly |
| `applicant.race` | Race | `flddBqott9LiWkU7B` | singleSelect | choices `Malay`/`Chinese`/`Indian`/`Others` — matches form exactly. **Was collected by the form but never sent by the payload before this update** — fixed in `SubmissionPayload.js` v1.2 (see [Code fixes made alongside this mapping](#code-fixes-made-alongside-this-mapping)) |
| `applicant.religion` | Religion | `fldCfCEgVBheiP59b` | singleSelect | choices `Islam`/`Christianity`/`Buddhism`/`Hinduism`/`Others` — matches form exactly. Same fix as Race above |
| `applicant.email` | Email | `fldZrSYrCe4giHdRj` | email | |
| `applicant.mobileNumber` | Phone Number | `fldC4HiTmnBhEOX1i` | phoneNumber | |
| `applicant.address` | Residential Address | `fldXlKVq8ekzradMS` | multilineText | |

### Employment

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `employment.employmentType` | Employment Type | `fldRv12qMSl92PxSb` | singleSelect | **Choice mismatch — see [Known caveats](#known-caveats--recommended-fixes) #1** |
| `applicant.occupation` | Occupation | `fldsPZqyYtbfEYOcN` | singleLineText | |
| `employment.fieldOfWork` | Field of Work | `fldxxN9HNak7NzlTD` | singleLineText | |
| `employment.employerName` | Employer's Name | `fld5WjvqUbF3G2JSZ` | singleLineText | |
| `employment.workAddress` | Work Place Address | `fldp1f6pzyAjFmjIc` | multilineText | |
| `employment.monthlyIncome` | Monthly Income | `fldjmgJBCO71ruzUo` | currency | payload sends a plain number as a string; Airtable will coerce on write |

### Family Information

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `family.maritalStatus` | Marital Status | `fldparTVSjgTq5RM0` | singleSelect | choices match form exactly |
| `family.spouseName` | Spouse Name | `fldgmAjHVLjqjfEs2` | singleLineText | |
| `family.spouseNric` | Spouse NRIC | `fld3ZeLJA9d84jmS1` | singleLineText | |
| `family.numChildren` | Number of Children | `fldSMIHrniBcj90sN` | number | |
| `family.childrenDetails` | Children Details | `fldSUGKekPUAZhOhz` | multilineText | |

### Medical History

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `medicalHistory.preExistingConditions` | Pre-existing Medical Conditions | `fldi62m4xgGPxtvd0` | multilineText | |
| `medicalHistory.currentMedications` | Current Medications | `fld4eE9JXrvcdGwBd` | multilineText | |
| `medicalHistory.allergies` | Allergies | `fld08Ij32MEn0sdKV` | multilineText | |
| `medicalHistory.previousSurgeryOrHospitalisation` | Previous Surgery/Hospitalization | `fld8ieaYpMclz5NJc` | multilineText | |
| `medicalHistory.smokingStatus` | Smoking Status | `fldp0Xpfj1pXFctYS` | singleSelect | **Choice mismatch — see [Known caveats](#known-caveats--recommended-fixes) #2** |
| `medicalHistory.height` | Height (cm) | `fldSP8oCVGTp9KWsr` | number | |
| `medicalHistory.weight` | Weight (kg) | `fld3BDEHonLhZU0ZU` | number | |

### Plan Selection (step section, incl. Beneficiary)

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `beneficiaries[0].name` | Beneficiary Name | `fldmEszQhoaAEu6cL` | singleLineText | payload's `beneficiaries` is an array (0 or 1 entries in the current single-beneficiary form) |
| `beneficiaries[0].nric` | Beneficiary NRIC | `fldtSbQNsSre5kv06` | singleLineText | |
| `beneficiaries[0].relationship` | Beneficiary Relationship | `fldVs3vJIBy361uBM` | singleLineText | |
| `beneficiaries[0].percentage` | Benefit Weightage (%) | `fldFxKuYmtm4iKow2` | number | |

### Selected Plan

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `selectedPlan` | Selected Plan | `fldFnJBVVMIJtJZsY` | singleLineText | **New field.** The real, dynamic plan name the client picked (e.g. "Medic TotalCare Plan 200") — not the old fixed 2-tier list, see [Deprecated: Legacy Plan Tier](#deprecated-legacy-plan-tier) |
| `selectedPlanDetails.monthlyContribution` | Selected Plan Monthly Contribution | `flds7mm7iDNdQnPvD` | singleLineText | Resolved back to the *chosen* option's own numbers — correct even if the client picked option 2 or 3 of a compared set, not just the first-generated quotation |
| `selectedPlanDetails.roomAndBoard` | Selected Plan Room & Board | `fldOmxORzw9aTMCpp` | singleLineText | |
| `selectedPlanDetails.annualLimit` | Selected Plan Annual Limit | `fldV8FpJd0hqyqFxV` | singleLineText | |

### Documents

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `documents.nricFront` | NRIC Front Photo | `fldcA1s5q4Z0rtiqY` | multipleAttachments | **Base64 — needs a script step, see [Known caveats](#known-caveats--recommended-fixes) #3** |
| `documents.nricRear` | NRIC Rear Photo | `fldHEAMMWfAemuvkz` | multipleAttachments | same |
| `documents.selfie` | Selfie with IC Photo | `fldRMW9bVDHuQX1Vq` | multipleAttachments | same |
| `documents.signature` | Signature | `fld1NfhD4qEcvMZnm` | multipleAttachments | same |

### Bank Details

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `bank.bankName` | Bank Name | `fldkir2sJN3RXYZxr` | singleLineText | |
| `bank.accountNumber` | Account Number | `fldgqv8q2HjHgCRgk` | singleLineText | |
| `bank.accountHolderName` | Account Holder Name | `fldjrXGtiqczZjmNv` | singleLineText | |

### Agent Information

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `agent.name` | Agent Name | `fldcs8LUm2pR72Uab` | singleLineText | **New field** |
| `agent.agency` | Agent Agency | `fldg9dPnooaHCwOK7` | singleLineText | **New field** |
| `agent.branch` | Agent Branch | `fldp7jZbzVSlCCOFU` | singleLineText | **New field** |
| `agent.phone` | Agent Phone | `fldqOMGWD5sbXKxwB` | phoneNumber | **New field.** Was computed but never sent by the payload before this update — fixed in v1.2 |
| `agent.email` | Agent Email | `fldRuIKo0uMkY2anp` | email | **New field.** Same fix as Agent Phone |

### Quotation Information

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `quotation.quotationNumber` | Quotation Number | `fldv2qEBK94C2GlgF` | singleLineText | **New field** |
| `quotation.validUntilIso` | Quotation Valid Until | `fldp4uVS4hkpBy95o` | date | **New field.** `validUntilIso` is new in payload v1.2 so this can be a real date field instead of re-parsing `quotation.validUntil`'s human-formatted string |
| `quotation.monthlyContribution` | Quotation Monthly Total Amount Payable | `fldBr1gVvZlNttyJS` | singleLineText | **New field, renamed from "Quotation Monthly Contribution"** to match the PruBSN Product Illustration's own term. Always fixed 2dp (e.g. `"RM 176.00"`, never `"RM176"`/`"RM 176"`) — kept as text rather than currency to avoid a lossy string→number coercion. Extracted directly from the PDF; only derived (Total Annual Contribution ÷ 12) if that field is genuinely missing — see `renderer/formatters.js`'s `resolveMonthlyTotalPayable`. |
| `quotation.riders` | Quotation Riders | `fldvO6OYtWm3v8sKy` | multilineText | **New field.** Join the array with `\n` in the Automation (e.g. an Airtable formula/script step, or a "Format text" action) |
| `metadata.product` | Quotation Product | `fldjWwD1KpYwm8AfH` | singleLineText | **New field** |
| `plansCompared` | Plans Compared (JSON) | `fldp2IAS3urtZdo6y` | multilineText | **New field.** `JSON.stringify(plansCompared)` — every quotation (1-3) the client was actually shown, kept verbatim so a comparison session's other options are never lost even though only the selected one gets its own columns |

### Submission Status / audit trail

| Payload path | Airtable field | Field ID | Type | Notes |
|---|---|---|---|---|
| `metadata.submissionId` | Submission ID | `fldTYKMltCzgzA3fv` | singleLineText | **New field.** Stable per application, reused across retries — use as the Automation's dedupe/upsert key if "find or create" is available, so a retried submission updates the same row instead of creating a duplicate |
| *(not in payload — business workflow state)* | Submission Status | `fldmZDjQyR5fixO1v` | singleSelect | **New field.** Choices: `Received`, `In Review`, `Documents Verified`, `Approved`, `Rejected`, `Needs Follow-up`. Set the Automation's Create Record action to default this to `Received` — the payload itself has no opinion on workflow state |
| `metadata.submittedAt` | Submitted At | `fldxUyHVLMZz2ZWiZ` | dateTime | **New field** |
| `metadata.parserVersion` | Parser Version | `fldmq7SzTL6dmU5Lb` | singleLineText | **New field.** Audit/debugging aid — which frozen `parser/` tag produced the underlying quotation |
| `metadata.rendererVersion` | Renderer Version | `fldpc8XNQPV5LkZmG` | singleLineText | **New field** |
| `version` | Payload Version | `fldUnNtlv2KVKuM5T` | singleLineText | **New field.** Lets you tell old vs. new records apart as the payload schema evolves |

### Created Date / Updated Date

| Airtable field | Field ID | Type (current) | Notes |
|---|---|---|---|
| Created Date | `fldVUPbuIWF6yUMHy` | dateTime (placeholder) | **Action needed:** the field-creation API this project has access to cannot create Airtable's native "Created time" field type. In the Airtable UI, edit this field's type to **Created time** (Field type picker → Created time) so it auto-populates with no Automation action needed. Until converted, nothing writes to it. |
| Updated Date | `flduTDbBR2tHJBn0B` | dateTime (placeholder) | Same — convert to Airtable's native **Last modified time** type in the UI. Optionally scope it to only the columns above (not Submission Status) so agent status changes don't masquerade as the client having updated their application. |

## Known caveats & recommended fixes

1. **Employment Type choice mismatch.** The field's existing choices are `Employee`, `Self-employed`, `Business Owner`. The form actually sends `Employed`, `Self-Employed`, `Business Owner`, `Unemployed`, `Retired`, or `Student` (see `browser-tool/application/ApplicationForm.js`). Only `Business Owner` matches exactly. This project's Airtable access can create new fields but not add choices to an existing select field — pick one:
   - **Recommended:** in the Automation's "Create record" action, enable **"Allow the automation to add new options"** for this field (works for any current or future value without hand-maintaining a choice list).
   - Or manually add `Employed`, `Self-Employed`, `Unemployed`, `Retired`, `Student` as choices via Field type → Edit field in the Airtable UI (2 minutes, one-time).
2. **Smoking Status choice mismatch.** Existing choices are `Non-smoker`, `Smoker`, `Former Smoker`; the form sends `Non-Smoker` (capital S). Same two remediation options as #1 — either enable "allow new options," or add `Non-Smoker` as an additional choice.
3. **Document attachments are base64, not URLs.** `documents.nricFront/nricRear/selfie` each carry `{ filename, mimeType, base64 }`. Airtable's no-code field mapping for a `multipleAttachments` field expects a URL Airtable can fetch, not inline base64 — a plain field-mapping action cannot populate these 3 fields. Use a **"Run a script"** action after the record is created, calling Airtable's attachment upload endpoint directly (it accepts base64 natively, no external hosting required):
   ```
   POST https://content.airtable.com/v0/{baseId}/{recordId}/{attachmentFieldId}/uploadAttachment
   Body: { "contentType": "<mimeType>", "file": "<base64>", "filename": "<filename>" }
   ```
   Call it once per uploaded document (skip any that are absent — the client may not have reached the Documents step successfully, though the form requires all 3 before Submit is enabled).
4. **`quotation.*` reflects the primary quotation, not necessarily the selected one.** When an agent generates 2-3 quotations for comparison, `quotation.quotationNumber`/`validUntil`/`monthlyContribution`/`riders` always describe the *first-generated* one (it's the document the client actually opened). If the client picks a different option in Plan Selection, use `selectedPlan`/`selectedPlanDetails` (not `quotation.*`) for what they actually agreed to — this is exactly why those fields were added in payload v1.2.
5. **`Essential Plan Price (RM/month)` and `Plant Details (from PDF)`** (an Airtable AI field) are pre-existing fields unrelated to this mapping — the AI field in particular is Airtable-computed, not writable via the webhook, and its accuracy is not guaranteed by this project. Leave both alone; do not map anything to them.

## Deprecated: Legacy Plan Tier

The field originally named `Plant Selection` (typo) was a fixed `Platinum Plan` / `Essential Plan` 2-choice field from the older, now-retired standalone intake form. It has been **renamed to `Legacy Plan Tier (Deprecated)`** (still `fldXqcxsieVlaeOJf`, still `singleSelect`, choices unchanged) rather than deleted or retyped, to preserve the 6 existing historical records that reference it. Do not map new submissions to it — use `Selected Plan` (`fldFnJBVVMIJtJZsY`) instead.

## Deprecating the Applications table

`Applications` (`tblXqOyu2djDBfFuJ`) is the table the webhook's Automation comment in `clientRuntime.js` previously referenced. As of 2026-07-21 it holds 3 blank test records with no populated fields — it was never successfully receiving data. Per this task's requirement not to split one customer's data across tables without a strong technical reason, **repoint the Automation's Create Record action from `Applications` to `Clients`** using the mapping above, then leave `Applications` in place but unused (archiving/deleting it is a separate, more destructive decision outside this task's scope — left for a deliberate follow-up, not done automatically here).

## Code fixes made alongside this mapping

While building this mapping, two places where the client's real, submitted answers were silently never reaching the payload were found and fixed in `browser-tool/models/SubmissionPayload.js` (bumped to schema **v1.2** — additive only, no existing field renamed or moved):

- `applicant.race` / `applicant.religion` — collected and validated on Step 1, shown on the Review step, but never included in the object `AirtableDestination.js` actually POSTs. Now included.
- `agent.phone` / `agent.email` — already resolved into `prefillData.agent` at document-generation time, but `buildAgentInfo()` only forwarded `name`/`agency`/`branch`. Now included when known.
- `plansCompared` (new) and `selectedPlanDetails` (new) — previously, if a client compared 2-3 quotations and picked one that wasn't the first, only that plan's *name* survived into the payload; its price/room & board/annual limit, and the other option(s) shown, were lost. Both are now carried through.

`browser-tool/application/buildPrefillData.js` gained one new pass-through field, `quotation.validUntilIso` (the ISO string alongside the existing human-formatted `quotation.validUntil`), so `Quotation Valid Until` above can be a real Airtable date field.

## Schema changes made (2026-07-21)

Applied directly to the live base via Airtable's API:

- **23 new fields** added to `Clients` (listed in the section tables above, each marked "New field").
- **1 field renamed** (`Plant Selection` → `Legacy Plan Tier (Deprecated)`) with an explanatory description; type and choices left untouched to avoid altering the 6 existing records that reference it.
- **Nothing deleted.** `Applications` table, `Essential Plan Price (RM/month)`, and `Plant Details (from PDF)` were all left exactly as found.

Not done (needs a short manual step in the Airtable UI — not reachable from this project's API access, see caveats above):

- Converting `Created Date` / `Updated Date` to Airtable's native Created time / Last modified time field types.
- Adding the missing Employment Type / Smoking Status choices (or enabling "allow new options" on the Automation action).
- Reconfiguring the Automation's action to map onto `Clients` instead of `Applications`, and adding the "Run a script" step for document attachments.
