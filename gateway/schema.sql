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
  trust_tier     TEXT,               -- "own" | "registry:<origin>", if verified
  purpose         TEXT,              -- declared purpose (X-Agent-Purpose), Demo 2 only
  policy_decision TEXT,              -- "allow" | "deny", Demo 2 only
  policy_reason   TEXT,              -- "purpose-prohibited" | "purpose-undeclared", Demo 2 only
  acting_for        TEXT,            -- claimed email (X-Acting-For), Demo 3 only
  delegation_outcome TEXT            -- "granted" | "no-code" | "invalid-code", Demo 3 only
);

CREATE INDEX IF NOT EXISTS access_log_ts ON access_log (ts DESC);

-- Migration for a database created before trust_tier existed (2026-09-11):
--   npx wrangler d1 execute eleviq-lab-log --local  --command "ALTER TABLE access_log ADD COLUMN trust_tier TEXT"
--   npx wrangler d1 execute eleviq-lab-log --remote --command "ALTER TABLE access_log ADD COLUMN trust_tier TEXT"

-- Migration for a database created before Demo 2 / Decide (2026-09-14):
--   npx wrangler d1 execute eleviq-lab-log --local  --command "ALTER TABLE access_log ADD COLUMN purpose TEXT"
--   npx wrangler d1 execute eleviq-lab-log --local  --command "ALTER TABLE access_log ADD COLUMN policy_decision TEXT"
--   npx wrangler d1 execute eleviq-lab-log --local  --command "ALTER TABLE access_log ADD COLUMN policy_reason TEXT"
--   (repeat all three with --remote for the deployed database)

-- Migration for a database created before Demo 3 / Delegate (2026-09-14):
--   npx wrangler d1 execute eleviq-lab-log --local  --command "ALTER TABLE access_log ADD COLUMN acting_for TEXT"
--   npx wrangler d1 execute eleviq-lab-log --local  --command "ALTER TABLE access_log ADD COLUMN delegation_outcome TEXT"
--   (repeat both with --remote for the deployed database)
