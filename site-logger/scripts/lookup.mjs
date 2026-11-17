#!/usr/bin/env node
/**
 * Look up field-test visits by test id (agent-analytics Appendix B protocol).
 *
 *   node site-logger/scripts/lookup.mjs [--local] <id> [<id> …]
 *
 * Prints every logged visit to /t/<id> (read-only SELECT on eleviq-site-log):
 * time, stored signals, and the class the dashboards show (shared deriveVisitor).
 * Run from the eleviq-lab root.
 */
import { execFileSync } from "node:child_process";
import { deriveVisitor } from "../../shared/derive.ts";

const args = process.argv.slice(2);
const local = args.includes("--local");
const ids = args.filter((a) => a !== "--local");
const ID = /^[a-z0-9-]{4,40}$/;
if (!ids.length || ids.some((i) => !ID.test(i))) {
  console.error("usage: lookup.mjs [--local] <id> …   (ids: a-z, 0-9, -; 4–40 characters)");
  process.exit(2);
}

// Ids are validated above, so they are safe to put into the SQL text.
const paths = ids.flatMap((i) => [`'/t/${i}'`, `'/t/${i}/'`]).join(", ");
const sql = `SELECT ts, path, country, ua_match, ua_raw, cf_bot_category, sig_status, sig_agent,
  referrer_agent, referral_signal, internal, visitor, visitor_category
  FROM page_views WHERE path IN (${paths}) ORDER BY ts`;

const out = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "eleviq-site-log", local ? "--local" : "--remote", "--config", "site-logger/wrangler.toml", "--json", "--command", sql],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const rows = JSON.parse(out)[0].results;

for (const id of ids) {
  const mine = rows.filter((r) => r.path.replace(/\/$/, "") === `/t/${id}`);
  console.log(`\n== ${id}: ${mine.length} visit(s)`);
  for (const r of mine) {
    const c = deriveVisitor(r);
    const ref = r.referrer_agent ? `${r.referrer_agent} (${r.referral_signal})` : "—";
    console.log(`  ${r.ts}  ${r.country ?? "??"}  internal=${r.internal}`);
    console.log(`    signals: ua_match=${r.ua_match ?? "—"} cf=${r.cf_bot_category ?? "—"} sig=${r.sig_status ?? "—"}${r.sig_agent ? ` (${r.sig_agent})` : ""} referral=${ref}`);
    console.log(`    ua_raw:  ${r.ua_raw === null ? "(browser-looking, not stored)" : JSON.stringify(r.ua_raw)}`);
    console.log(`    shown:   kind=${c.kind} level=${c.level ?? "—"} method=${c.method ?? "—"} name=${c.name ?? "—"}${c.flags.length ? ` flags=${c.flags.join(",")}` : ""}${c.notes.length ? ` notes=${c.notes.join(",")}` : ""}`);
  }
}
