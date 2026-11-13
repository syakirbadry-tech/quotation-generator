-- 0003_create_presentation_answers.sql
--
-- Answers clients tap during a story presentation (see src/answers.js).
-- The Worker creates this on first use with CREATE ... IF NOT EXISTS, so
-- applying this file by hand is optional:
--   wrangler d1 execute prubsn-quotations --remote --file=migrations/0003_create_presentation_answers.sql

CREATE TABLE IF NOT EXISTS presentation_answers (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  client       TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT '',
  agent_email  TEXT NOT NULL DEFAULT '',
  agent_name   TEXT NOT NULL DEFAULT '',
  answers_json TEXT NOT NULL,
  summary_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presentation_answers_agent ON presentation_answers(agent_email);
