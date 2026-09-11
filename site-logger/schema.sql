-- eleviq.solutions site traffic log.
--
--   npx wrangler d1 execute eleviq-site-log --local  --file=schema.sql
--   npx wrangler d1 execute eleviq-site-log --remote --file=schema.sql
--
-- One row per HTML page response (assets are not logged). Anonymous:
-- no cookie, no persistent visitor id, no raw IP. Written by site-logger,
-- a passthrough Worker in front of eleviq.solutions — see src/index.ts.
--
-- Logging every visitor category for now (human / search / training / agent
-- / unrecognized) — see lib/classify.ts. Deliberately not filtering
-- training/search crawlers out yet; that's a one-line WHERE-clause once
-- there's real data to decide from, not a re-instrumentation.

CREATE TABLE IF NOT EXISTS page_views (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL,   -- ISO 8601
  path            TEXT    NOT NULL,
  visitor         TEXT    NOT NULL,   -- 'human' | an agent name | 'unrecognized agent' etc.
  visitor_category TEXT   NOT NULL,   -- human | search | training | agent | unrecognized
  cf_bot_category TEXT,               -- Cloudflare's own heuristic (request.cf.verifiedBotCategory), if any
  referrer_agent  TEXT,               -- AI assistant UI the Referer matched, if any (e.g. "ChatGPT")
  country         TEXT
);

CREATE INDEX IF NOT EXISTS page_views_ts ON page_views (ts DESC);

-- Migration for a database created before visitor_category existed:
--   npx wrangler d1 execute eleviq-site-log --local  --command "ALTER TABLE page_views ADD COLUMN visitor_category TEXT"
--   npx wrangler d1 execute eleviq-site-log --remote --command "ALTER TABLE page_views ADD COLUMN visitor_category TEXT"
