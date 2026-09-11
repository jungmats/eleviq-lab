-- ElevIQ Lab gateway — access log.
--
--   npx wrangler d1 execute eleviq-lab-log --local  --file=schema.sql   (local dev)
--   npx wrangler d1 execute eleviq-lab-log --remote --file=schema.sql   (deployed)
--
-- One row per request to a protected resource, verified or not. This is the
-- foundation Demo 4 (Measure) builds a dashboard over; for now, inspect it with
--   npx wrangler d1 execute eleviq-lab-log --remote \
--     --command "SELECT ts, path, outcome, agent_name, status FROM access_log ORDER BY ts DESC LIMIT 20"

CREATE TABLE IF NOT EXISTS access_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             TEXT    NOT NULL,   -- ISO 8601
  path           TEXT    NOT NULL,
  outcome        TEXT    NOT NULL,   -- verified | unsigned | unknown-key | expired | invalid
  status         INTEGER NOT NULL,   -- HTTP status returned
  keyid          TEXT,               -- signing key thumbprint, if any
  agent_name     TEXT,               -- verified agent name, if verified
  agent_operator TEXT,               -- verified operator, if verified
  claimed_ua     TEXT,               -- the unverified User-Agent / X-Demo-Agent-Claim
  trust_tier     TEXT                -- "own" | "registry:<origin>", if verified
);

CREATE INDEX IF NOT EXISTS access_log_ts ON access_log (ts DESC);

-- Migration for a database created before trust_tier existed (2026-09-11):
--   npx wrangler d1 execute eleviq-lab-log --local  --command "ALTER TABLE access_log ADD COLUMN trust_tier TEXT"
--   npx wrangler d1 execute eleviq-lab-log --remote --command "ALTER TABLE access_log ADD COLUMN trust_tier TEXT"
