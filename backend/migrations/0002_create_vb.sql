-- 0002_create_vb.sql
--
-- VB prospect pipeline for the agent portal (see src/vb.js). The Worker
-- creates these on first use with CREATE ... IF NOT EXISTS, so applying
-- this file by hand is optional:
--   wrangler d1 execute prubsn-quotations --remote --file=./migrations/0002_create_vb.sql

CREATE TABLE IF NOT EXISTS vb_prospects (
  id             TEXT PRIMARY KEY,
  owner_email    TEXT NOT NULL,          -- the agent/leader/owner who added the name; only they see it
  owner_name     TEXT NOT NULL,          -- shown to leaders next to counts (never with prospect names)
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  stage          INTEGER NOT NULL DEFAULT 1, -- 1 new name, 2 contacted, 3 appointment, 4 policy approved
  created_at     TEXT NOT NULL,
  contacted_at   TEXT,
  appointment_at TEXT,
  approved_at    TEXT,
  product        TEXT,
  premium        REAL,
  frequency      TEXT,                   -- Monthly / Quarterly / Half-yearly / Yearly
  tpc            REAL,                   -- premium x payments per year
  cases          REAL,                   -- 1 if tpc >= 1800, else 0.5
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vb_prospects_owner ON vb_prospects(owner_email);
