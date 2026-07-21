# Deployment — Submission Backend (Cloudflare Worker)

This covers deploying `backend/`, the Cloudflare Worker that receives client application submissions from the browser and writes them to Airtable's `Clients` table via Airtable's REST API.

## Why this exists

The frontend used to POST directly to an Airtable Automation webhook. A production audit found that architecture **cannot work at all**: Airtable's webhook endpoint sends no `Access-Control-Allow-Origin` (or any other CORS) header, so a browser's `fetch()` to it is blocked by CORS before the request completes — from *any* origin (`file://`, a hosted page, everything). This was verified independently three ways (see `browser-tool/destinations/AirtableDestination.js`'s header comment for the full detail):

1. A real `fetch()` from both `file://` and `http://localhost` to the real webhook URL failed with "Failed to fetch".
2. `curl` to the same URL succeeded fine (network/DNS were never the issue) — but the response carried no CORS header.
3. Simulating the browser's exact CORS preflight (`OPTIONS` with `Access-Control-Request-Method`) got a `200` back with no CORS headers either.

This Worker fixes that: it sends proper CORS headers itself, holds the real Airtable credential server-side (never shipped to the browser), and talks to Airtable's REST API directly.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (the free tier is sufficient).
- Node.js (already required for the rest of this project).
- An Airtable [Personal Access Token](https://airtable.com/create/tokens) scoped to:
  - **Scope:** `data.records:write` (and `data.records:read` if you want to verify writes via the API)
  - **Access:** the base containing the `Clients` table (base ID `appcA4lwc8KrLNxwM`)

## Local development

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste a real Airtable PAT (never commit this file - it's gitignored)
npm run dev
```

This starts `wrangler dev`, which runs the **real** Workers runtime (`workerd`) locally, not a simulation — `http://localhost:8788` behaves like the deployed Worker, including real CORS enforcement. Point the frontend at it temporarily by editing `browser-tool/application/clientRuntime.js`'s `AirtableDestination.configure({ endpointUrl: ... })` call to `http://localhost:8788/submit`, then `npm run build:browser-tool` from the repo root. **Revert that URL before committing** — the placeholder in the repo should always be the real deployed Worker URL (or the literal `YOUR_SUBDOMAIN` placeholder if not yet deployed).

## Running the backend's tests

```bash
cd backend
npm test
```

Runs `test/validate.test.js`, `test/airtable.test.js`, and `test/worker.test.js` — plain Node scripts (matching this project's existing test style), no real network calls (Airtable's API is mocked via `global.fetch`). Covers: successful submission, 400 invalid payload, 413 payload too large, 429 rate limiting, 500 Airtable failure, timeout handling, malformed JSON, and that secrets never leak into a response. (401/unauthorized is deliberately not implemented — see [Security notes](#security-notes) below — and is covered by a test asserting that an unauthenticated request is correctly *allowed*, not a gap.)

## Production deployment

```bash
cd backend
npx wrangler login          # one-time, opens a browser to authorize wrangler against your Cloudflare account
wrangler secret put AIRTABLE_PAT
# paste your Airtable PAT when prompted - this is stored encrypted by Cloudflare, never in any file
wrangler deploy
```

`wrangler deploy` prints the live URL, something like:

```
https://prubsn-submission-service.<your-subdomain>.workers.dev
```

**After deploying:**

1. Edit `browser-tool/application/clientRuntime.js` — set `endpointUrl` to `<that URL>/submit`.
2. Rebuild the browser tool from the repo root: `npm run build:browser-tool`.
3. Do one real end-to-end submission through the actual UI and confirm a record appears in the `Clients` table with `Submission Status = Received`.

### Configuration reference

All non-secret configuration lives in `backend/wrangler.toml` under `[vars]`:

| Variable | Purpose | Default |
|---|---|---|
| `AIRTABLE_BASE_ID` | The Airtable base to write to | `appcA4lwc8KrLNxwM` |
| `AIRTABLE_TABLE_ID` | The table to write to (the `Clients` table's ID, not its display name — stable even if the table is renamed) | `tblmBQko8J7yOsBbv` |
| `ALLOWED_ORIGIN` | Value sent as `Access-Control-Allow-Origin` | `*` |

| Secret (never in a tracked file) | Purpose | Set via |
|---|---|---|
| `AIRTABLE_PAT` | Airtable Personal Access Token, write access to the base above | `wrangler secret put AIRTABLE_PAT` (production) / `backend/.dev.vars` (local, gitignored) |

`ALLOWED_ORIGIN` defaults to `*` because this endpoint is a public application-submission form with no login system anywhere in this project (see [Security notes](#security-notes)) — there is no single "our frontend's origin" to restrict to, since the generated client document can be opened from `file://`, emailed, or hosted anywhere. Restricting it would not add meaningful security (the payload contains no secret, and the Worker itself authenticates to Airtable, not the browser), only a maintenance burden.

### Optional: rate limiting

Rate limiting (20 requests/minute per IP, fixed window) is implemented but inert until a KV namespace is bound:

```bash
cd backend
npx wrangler kv namespace create RATE_LIMIT_KV
```

Paste the printed namespace `id` into the commented-out `[[kv_namespaces]]` block in `wrangler.toml`, uncomment it, and redeploy. Without this binding the Worker still works, just without rate limiting — nothing else changes.

### Optional: a staging environment

`wrangler.toml` has a commented-out `[env.staging]` block. Uncomment it, set its own secret (`wrangler secret put AIRTABLE_PAT --env staging`), and deploy with `wrangler deploy --env staging` to test against a separate Worker (and optionally a separate Airtable base/table) before touching production.

## Rollback procedure

Cloudflare keeps every previous deployment. To roll back:

```bash
cd backend
npx wrangler deployments list        # find the deployment ID you want to restore
npx wrangler rollback <deployment-id>
```

This takes effect immediately, with no rebuild needed. If the *frontend* also needs to roll back (e.g. a bad `endpointUrl` was deployed), that's a normal `git revert` of the commit that changed `clientRuntime.js`, followed by `npm run build:browser-tool` and redistributing the regenerated `browser-tool/index.html` / re-hosting it, same as any other frontend change in this project.

There is no database migration or schema change involved in either direction — the Worker only ever *writes* to the existing `Clients` table using the existing field mapping (`docs/AIRTABLE_FIELD_MAPPING.md`), so rolling the Worker back and forth is safe with respect to Airtable's schema.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser shows "Submission is not available right now. Please contact your agent." | `endpointUrl` in `clientRuntime.js` still has the `YOUR_SUBDOMAIN` placeholder, or points at a Worker that isn't deployed | Deploy the Worker, update the URL, rebuild |
| Browser shows "The submission service was unavailable." | The Worker reached Airtable but Airtable rejected the request (bad/expired PAT, PAT lacks write scope on this base, a field name mismatch) | Check `wrangler tail` (below) for the real error - it's logged server-side, deliberately never sent to the client |
| Browser shows a CORS error in the console | `ALLOWED_ORIGIN` was changed to a specific origin that doesn't match where the document is actually opened from | Set back to `*`, or to the exact origin in use |
| A submission "succeeds" but a document (NRIC photo) is missing on the Airtable record | The record-creation call succeeded but the attachment upload failed - this is logged, not treated as a submission failure (see `backend/src/airtable.js`'s header comment) | Check `wrangler tail` for `Document upload failures for record <id>`, then manually attach the file this once. Not expected to happen often - flagged in [remaining limitations](#remaining-limitations-carried-into-this-deployment) below |
| Everything "succeeds" in dev but nothing shows up in Airtable | You're testing against `wrangler dev` with a fake/placeholder `AIRTABLE_PAT` (see `.dev.vars.example`) | Use a real PAT locally, or accept that local dev intentionally fails the Airtable step while still proving the browser-to-Worker leg (CORS) works |

**Live log tailing** (see requests as they happen in production, without waiting for a bug report):

```bash
cd backend
npx wrangler tail
```

## Security notes

- The Airtable PAT is **only ever** stored as a Cloudflare secret (`wrangler secret put`) or in the gitignored local `backend/.dev.vars` file. It is never in `wrangler.toml`, never in any file the browser loads, and this Worker's own error responses are deliberately generic (`backend/src/worker.js`) so an upstream Airtable error message is never relayed verbatim to a client, even by accident.
- No API-key/bearer-token authentication is implemented on this endpoint (no `401` responses). This is deliberate, not an oversight: the endpoint receives a client's own application from their own browser, and this project has no login system anywhere. A shared "API key" baked into the frontend bundle would be visible to anyone who view-sources the page — the exact anti-pattern this whole migration exists to move away from (see `docs/AIRTABLE_FIELD_MAPPING.md`'s history of the legacy standalone form's embedded token leak) — so it would add the appearance of security without the substance.
- Payload validation, size limits (20MB total, 8MB per document), and rate limiting (optional, see above) are the actual abuse-resistance layer for a public, unauthenticated endpoint.

## Remaining limitations carried into this deployment

- Document-attachment upload failures are logged, not retried automatically. A transient failure on one of the three ID photos means that one photo needs manual follow-up (see the troubleshooting table above) - the core application data is never lost or blocked by this.
- Two Airtable single-select fields (`Employment Type`, `Smoking Status`) previously had a narrower/differently-cased choice list than the app sends; this Worker sends `typecast: true` on record creation, which lets Airtable add the missing options automatically, so this limitation (documented in `docs/AIRTABLE_FIELD_MAPPING.md` as a caveat of the old Automation-based approach) is resolved by this migration, not carried forward.
- The Airtable Automation that the old webhook pointed at is no longer used by anything in this project. It has not been deleted (out of scope for this migration - a separate, deliberate cleanup decision).
