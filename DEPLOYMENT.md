# Deployment — Submission Backend & Public Quotation Platform (Cloudflare Worker)

This covers deploying `backend/`, the Cloudflare Worker that (a) receives client application submissions from the browser and writes them to Airtable's `Clients` table via Airtable's REST API, and (b) since Phase 9, stores and publicly serves generated client quotations at a shareable `/q/{slug}-{id}` link, backed by a Cloudflare D1 database. See [Publishing platform (Phase 9)](#publishing-platform-phase-9) below for the second part.

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

Runs `test/validate.test.js`, `test/airtable.test.js`, `test/worker.test.js`, `test/publish.test.js`, and `test/routing.test.js` — plain Node scripts (matching this project's existing test style), no real network calls (Airtable's API is mocked via `global.fetch`; D1 is mocked via `test/fakeD1.js`, a minimal in-memory stand-in — see that file's header comment for why a real D1 binding can't be exercised from a plain `node` script). Covers: successful submission, 400 invalid payload, 413 payload too large, 429 rate limiting, 500 Airtable failure, timeout handling, malformed JSON, secrets never leaking into a response, quotation publish/fetch success, 404 for an unknown id, and a genuine unique-id collision retry. (401/unauthorized is deliberately not implemented on either endpoint — see [Security notes](#security-notes) below — and is covered by a test asserting that an unauthenticated request is correctly *allowed*, not a gap.)

## Live production deployment

Deployed 2026-07-21. These are the real, current values — update this section if the Worker is ever redeployed under a different name/account/database.

| Item | Value |
|---|---|
| **Worker name** | `prubsn-submission-service` |
| **Worker URL** | `https://prubsn-submission-service.syakirbadry.workers.dev` |
| **Cloudflare account** | `Syakirbadry@gmail.com's Account` (`84081737ffdc9651eb289060a0860efb`) |
| **D1 binding name** | `QUOTATIONS_DB` |
| **D1 database name** | `prubsn-quotations` |
| **D1 database ID** | `5541a426-c913-47fc-a018-55f7c9e3113a` |
| **D1 region** | APAC |
| **Secrets set** | `AIRTABLE_PAT` (rotated 2026-07-21 - see [Security notes](#security-notes)) |
| **Environment variables** (`[vars]` in `wrangler.toml`) | `AIRTABLE_BASE_ID=appcA4lwc8KrLNxwM`, `AIRTABLE_TABLE_ID=tblmBQko8J7yOsBbv`, `ALLOWED_ORIGIN=*` |
| **Optional bindings not yet configured** | `RATE_LIMIT_KV` (rate limiting is inert without it - see below) |

**Public quotation URL format:** `https://prubsn-submission-service.syakirbadry.workers.dev/q/{client-name-slug}-{8-char-hex-id}` (and the identical document also at `/app/{same-id}`) — e.g. `.../q/santun-syafitri-binti-mulyadi-8f93cbe2`.

### Deployment commands (what was actually run)

```bash
cd backend
npx wrangler login                                                              # one-time, interactive browser OAuth
npx wrangler d1 create prubsn-quotations                                        # prints the database_id - paste into wrangler.toml's [[d1_databases]] block
npx wrangler d1 execute prubsn-quotations --remote --file=./migrations/0001_create_quotations.sql
npx wrangler secret put AIRTABLE_PAT                                             # paste a real Airtable PAT when prompted
npx wrangler deploy                                                              # prints the live Worker URL
```

**After deploying:** `browser-tool/publishQuotation.js`'s `PUBLISH_ENDPOINT` and `browser-tool/application/clientRuntime.js`'s `endpointUrl` both already point at the real deployed URL above — rebuild with `npm run build:browser-tool` from the repo root after any future redeploy under a different URL.

### Rollback commands

```bash
cd backend
npx wrangler deployments list                # find the deployment ID to restore
npx wrangler rollback <deployment-id>         # takes effect immediately, no rebuild needed
```

D1 has no equivalent "rollback" primitive — schema changes are additive-only migrations (`migrations/NNNN_*.sql`); reversing a bad migration means writing and applying a new migration that undoes it, same as any SQL database without a built-in point-in-time restore for this workload. Published quotation *rows* are never touched by a Worker rollback either way (D1 is a separate resource from the Worker script).

### Migration commands

```bash
cd backend
# Local dev (creates/updates a local SQLite file under .wrangler/state - never touches production):
npx wrangler d1 execute prubsn-quotations --local --file=./migrations/0001_create_quotations.sql
# Production (the real D1 database):
npx wrangler d1 execute prubsn-quotations --remote --file=./migrations/0001_create_quotations.sql
```

Any future schema change: add a new `migrations/000N_description.sql` file (never edit `0001_create_quotations.sql` after it's been applied to production) and run the `--remote` command above for it.

## Production deployment (general instructions for a fresh account/Worker)

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

| Binding | Purpose | Set via |
|---|---|---|
| `QUOTATIONS_DB` (D1) | Phase 9 - stores published quotations for `/publish` and `/q/:id`, `/app/:id` | `wrangler d1 create` + `[[d1_databases]]` in `wrangler.toml` - see [Publishing platform](#publishing-platform-phase-9) above |

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

## Publishing platform (Phase 9)

As of Phase 9, the same Worker also stores and serves generated client quotations at a public, shareable link — `POST /publish` (called by the agent tool after "Generate"), and `GET /q/:id` / `GET /app/:id` (what the client actually opens). This is what makes `browser-tool/index.html`'s "Copy Client Link"/"Open Client View" buttons work. See `backend/src/publish.js`'s header comment for the full design rationale (in short: GitHub Pages is a static host and can't serve a URL that didn't exist at build time, so a generated quotation has to be handed to something always-running to get a real public URL).

**This is a real, separate posture change from the rest of this project**: every generated quotation's client name, plan, contribution figures, and full rendered HTML are sent to and stored by this Worker, and become reachable by anyone with the exact link (no login) — see `browser-tool/publishQuotation.js`'s header comment. Confirmed as an acceptable, deliberate trade-off (unguessable-URL-only, same posture as e.g. many billing/quote portals) — not silently introduced.

### One-time setup: create the D1 database

```bash
cd backend
npx wrangler d1 create prubsn-quotations
```

This prints a `database_id`. Paste it into the `[[d1_databases]]` block in `wrangler.toml` (currently commented out) and uncomment the block:

```toml
[[d1_databases]]
binding = "QUOTATIONS_DB"
database_name = "prubsn-quotations"
database_id = "<paste-the-id-here>"
```

Then apply the schema:

```bash
npx wrangler d1 execute prubsn-quotations --remote --file=./migrations/0001_create_quotations.sql
```

(For local development only, use `--local` instead of `--remote` — this creates a local SQLite file under `.wrangler/state/` and never touches the real Cloudflare D1 resource. Useful for exercising `wrangler dev` end-to-end without any real infrastructure.)

Without this binding configured, `POST /publish` and `GET /q/:id`/`/app/:id` return a clean `not_configured` error — `/submit` (client application submissions) is entirely unaffected either way, since it doesn't use D1 at all.

### After deploying: point the browser tool at the live publish endpoint

Edit `browser-tool/publishQuotation.js` — set `PUBLISH_ENDPOINT` to `<your Worker URL>/publish` (same URL as `/submit`, different path). Rebuild: `npm run build:browser-tool` from the repo root.

### Custom domain (optional)

The Phase 9 spec's example public URL used a branded domain (`quote.asgansargroup.com`). By default this project ships pointed at the Worker's own `*.workers.dev` URL — attach a custom domain later via the Cloudflare dashboard (**Workers & Pages → your Worker → Settings → Domains & Routes → Add Custom Domain**), which requires that domain's DNS to already be on Cloudflare. No code change is needed on this project's side either way: every generated public URL is derived from the actual incoming request's own origin at publish time (see `backend/src/worker.js`'s `handlePublish`), so it automatically reflects whichever domain the Worker is actually reached through.

### What gets stored

See `backend/migrations/0001_create_quotations.sql` for the full schema. One row per published quotation: the client's name/plan/contribution figures (for potential future dashboard use), the renderer version that produced it, the full already-rendered HTML (served back byte-for-byte, never re-rendered), and the structured parser JSON alongside it. Nothing is ever deleted or expired automatically in this initial version — see [remaining limitations](#remaining-limitations-carried-into-this-deployment).

## Admin dashboard API (`/admin/*`)

Staff-only API behind the login page and submissions dashboard hosted at
`https://syakirbadry-tech.github.io/Client-Form/admin/`. Source: `backend/src/admin.js`.

| Route | Auth | Purpose |
|---|---|---|
| `POST /admin/login` | username + password | Returns a signed session token (valid 8 hours) |
| `GET /admin/submissions` | Bearer token | All submissions, summary columns only, newest first |
| `GET /admin/submissions/:id` | Bearer token | One full submission, including document photos |
| `PATCH /admin/submissions/:id` | Bearer token | Change `Submission Status` |

### One-time setup

1. **Give the Airtable token read access.** At <https://airtable.com/create/tokens>, edit the token stored in `AIRTABLE_PAT` and add the `data.records:read` scope (it previously only needed `data.records:write`). No redeploy needed for this step.
2. **Set the three admin secrets** (from `backend/`):
   ```bash
   npx wrangler secret put ADMIN_USERNAME              # e.g. syakir
   node scripts/hash-password.mjs 'your-strong-password'  # 12+ chars; prints pbkdf2$...
   npx wrangler secret put ADMIN_PASSWORD_HASH         # paste the printed pbkdf2$... value
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npx wrangler secret put ADMIN_SESSION_SECRET        # paste the random value
   ```
3. **Turn on login rate limiting (strongly recommended).** Create the KV namespace and uncomment the `[[kv_namespaces]]` block in `wrangler.toml` (see "Optional: rate limiting" above). With it, each IP gets 5 login attempts per minute; without it, logins are not rate limited.
4. `npx wrangler deploy`

`ADMIN_ALLOWED_ORIGIN` in `wrangler.toml` must match the dashboard's origin (`https://syakirbadry-tech.github.io`). Change it if the dashboard moves to a custom domain.

### Changing the password / signing everyone out

- New password: re-run `hash-password.mjs` and `wrangler secret put ADMIN_PASSWORD_HASH`. Existing sessions stay valid until they expire.
- Sign everyone out immediately: `wrangler secret put ADMIN_SESSION_SECRET` with a new random value.

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
| Clicking "Generate" shows "Could not publish this quotation: Publishing service is not configured." | The `QUOTATIONS_DB` D1 binding isn't set up yet, or `PUBLISH_ENDPOINT` in `publishQuotation.js` still has the `YOUR_SUBDOMAIN` placeholder | Follow [Publishing platform](#publishing-platform-phase-9) above, then rebuild |
| "Open Client View" opens a page saying "This link doesn't lead anywhere" | The `id` in the URL doesn't exist in `QUOTATIONS_DB` - typically because it was published against a different environment/database (e.g. local `wrangler dev` vs. production) than the one currently being queried | Confirm you're checking the same environment it was published to; re-generate and re-publish if the local dev database was reset |

**Live log tailing** (see requests as they happen in production, without waiting for a bug report):

```bash
cd backend
npx wrangler tail
```

## Security notes

- The Airtable PAT is **only ever** stored as a Cloudflare secret (`wrangler secret put`) or in the gitignored local `backend/.dev.vars` file. It is never in `wrangler.toml`, never in any file the browser loads, and this Worker's own error responses are deliberately generic (`backend/src/worker.js`) so an upstream Airtable error message is never relayed verbatim to a client, even by accident.
- **2026-07-21: the production `AIRTABLE_PAT` was rotated during this deployment.** The token first set had already been identified (Phase 7 audit, see `PROJECT_STATUS.md`) as leaked in the legacy standalone client form's client-side JS; setting it here as a server-side secret does not undo that prior exposure - anyone who ever received that old file still has full read/write access to the base through that same token, independent of this project. It was replaced with a freshly-created PAT scoped to `data.records:write` on this base only. If the *old* token hasn't been separately revoked in Airtable's own token management UI, do that too - rotating where it's *used* doesn't revoke where it still *works*.
- No API-key/bearer-token authentication is implemented on this endpoint (no `401` responses). This is deliberate, not an oversight: the endpoint receives a client's own application from their own browser, and this project has no login system anywhere. A shared "API key" baked into the frontend bundle would be visible to anyone who view-sources the page — the exact anti-pattern this whole migration exists to move away from (see `docs/AIRTABLE_FIELD_MAPPING.md`'s history of the legacy standalone form's embedded token leak) — so it would add the appearance of security without the substance.
- Payload validation, size limits (20MB total, 8MB per document), and rate limiting (optional, see above) are the actual abuse-resistance layer for a public, unauthenticated endpoint.
- **`POST /publish` has the same no-login posture, with one added check**: it rejects any `generatedHtml` that doesn't contain this renderer's own `id="pq-doc"` marker (see `backend/src/publish.js`), which stops arbitrary unrelated content from being stored and served from this domain, though it can't stop a determined caller who copies real output. There is no per-agent authentication anywhere in this project yet - this is a known, intentionally-scoped-out gap, not an oversight.
- Every published quotation is reachable indefinitely by anyone with its exact link, with no expiry and no login (confirmed deliberate - see [Publishing platform](#publishing-platform-phase-9) above).

## Remaining limitations carried into this deployment

- Document-attachment upload failures are logged, not retried automatically. A transient failure on one of the three ID photos means that one photo needs manual follow-up (see the troubleshooting table above) - the core application data is never lost or blocked by this.
- Two Airtable single-select fields (`Employment Type`, `Smoking Status`) previously had a narrower/differently-cased choice list than the app sends; this Worker sends `typecast: true` on record creation, which lets Airtable add the missing options automatically, so this limitation (documented in `docs/AIRTABLE_FIELD_MAPPING.md` as a caveat of the old Automation-based approach) is resolved by this migration, not carried forward.
- The Airtable Automation that the old webhook pointed at is no longer used by anything in this project. It has not been deleted (out of scope for this migration - a separate, deliberate cleanup decision).
- **(Phase 9)** No published quotation ever expires or can be un-published/deleted through this project's own tooling yet - it would need a direct `wrangler d1 execute` `DELETE` statement today. No per-agent authentication on `/publish` (see Security notes above). `GET /app/:id` currently serves the exact same document as `GET /q/:id` (the "Continue Application" flow is embedded in the same page, not a separate route) - a deliberate simplification, not an oversight.
- **(Phase 9)** The five full-bleed "Ken Burns" photo sections and all other `AssetManager`-driven images (plan tier, coverage, room & board, etc.) fall back to a placeholder panel until real production photography is supplied - see `browser-tool/assets/images/README.md` and `CHECKLIST.md`.
- **(Live production state)** `RATE_LIMIT_KV` is not yet bound in production - both `/submit` and `/publish` work correctly but without rate limiting. See "Optional: rate limiting" above to add it; no code change needed, just the KV namespace + a `wrangler.toml` binding + redeploy.
- **(Live production state)** No custom domain is attached yet - the production URL is the `*.workers.dev` default. See [Custom domain](#custom-domain-optional) above to attach one later; every generated public URL already derives from the request's own origin, so this needs no code change either.
