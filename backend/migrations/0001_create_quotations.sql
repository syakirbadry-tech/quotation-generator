-- 0001_create_quotations.sql
--
-- Storage for published client quotations (Phase 9 - public client
-- quotation platform). One row per generated quotation the agent chose
-- to publish. `id` is the full URL path segment
-- ("{client-name-slug}-{unique-id}") and is also the primary key, so a
-- lookup by URL is a single indexed read - no separate slug/id split
-- needed at read time.
--
-- `generated_html` is the exact, already-rendered document the browser
-- produced (renderer/renderNarrativeQuotation.js + composeClientDocument.js)
-- at publish time - served back byte-for-byte on GET /q/:id and GET
-- /app/:id. Never re-rendered on read: see backend/src/publish.js header
-- comment for why (a stored quotation must keep looking exactly as it did
-- the day it was sent, even if the renderer changes later).
--
-- `quotation_json` is kept alongside the HTML (not just the HTML) so a
-- future tool (a dashboard, a re-render-with-a-newer-template migration,
-- etc.) has the structured data to work from without re-parsing a PDF
-- that may no longer be on hand - matches the Phase 9 spec's explicit
-- storage requirement.
--
-- Apply with:
--   wrangler d1 execute prubsn-quotations --local --file=./migrations/0001_create_quotations.sql   (local dev)
--   wrangler d1 execute prubsn-quotations --remote --file=./migrations/0001_create_quotations.sql   (production, after `wrangler d1 create` - see ../DEPLOYMENT.md)

CREATE TABLE IF NOT EXISTS quotations (
  id                     TEXT PRIMARY KEY,      -- "{slug}-{unique_id}", e.g. "santun-syafitri-binti-mulyadi-8f93cbe2"
  slug                   TEXT NOT NULL,          -- client-name slug only, e.g. "santun-syafitri-binti-mulyadi"
  unique_id              TEXT NOT NULL,          -- the random component, e.g. "8f93cbe2"
  client_name            TEXT NOT NULL,
  plan                   TEXT,
  monthly_total_payable  TEXT,                   -- pre-formatted display string, e.g. "RM 176.00" - not a number, never recomputed
  annual_contribution    TEXT,
  application_status     TEXT NOT NULL DEFAULT 'Not Started',
  renderer_version       TEXT NOT NULL,          -- see renderer/renderNarrativeQuotation.js's RENDERER_VERSION
  quotation_json         TEXT NOT NULL,          -- JSON.stringify of parseQuotation()'s `data` object
  generated_html         TEXT NOT NULL,          -- the exact document served on GET /q/:id and /app/:id
  generated_date         TEXT NOT NULL           -- ISO 8601, when this row was inserted
);

CREATE INDEX IF NOT EXISTS idx_quotations_generated_date ON quotations(generated_date);
