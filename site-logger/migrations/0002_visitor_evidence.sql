-- Visitor evidence signals (requirements-visitor-evidence.md, LOG-1).
--
--   npx wrangler d1 execute eleviq-site-log --local  --config site-logger/wrangler.toml --file site-logger/migrations/0002_visitor_evidence.sql
--   npx wrangler d1 execute eleviq-site-log --remote --config site-logger/wrangler.toml --file site-logger/migrations/0002_visitor_evidence.sql
--
-- Additive only: existing rows get NULL (internal gets 0), and a Worker that
-- names its INSERT columns keeps working against the new schema.
-- sig_status NULL marks a row written before this migration ("not checked").

ALTER TABLE page_views ADD COLUMN ua_match TEXT;
ALTER TABLE page_views ADD COLUMN ua_raw TEXT;
ALTER TABLE page_views ADD COLUMN sig_status TEXT;
ALTER TABLE page_views ADD COLUMN sig_agent TEXT;
ALTER TABLE page_views ADD COLUMN referral_signal TEXT;
ALTER TABLE page_views ADD COLUMN internal INTEGER NOT NULL DEFAULT 0;
