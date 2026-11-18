#!/usr/bin/env node
/**
 * Marks ElevIQ's own test traffic as internal after the fact (INT-2), so it stays
 * out of the figures. For requests that cannot carry a valid marker by design:
 * the smoke test's rejection cases, and field tests, which must arrive unmarked to
 * be classified like real visitors.
 *
 *   node site-logger/scripts/mark-internal.mjs [--local] [--dry-run] smoke <run>
 *   node site-logger/scripts/mark-internal.mjs [--local] [--dry-run] tests
 *
 *   smoke <run>  rows whose User-Agent carries the smoke run id (smoke.mjs prints it)
 *   tests        every visit to a /t/<id> test page (field tests; lookup.mjs still finds them)
 *
 * Run it after checking the results: it changes the production log unless --local.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const local = args.includes("--local");
const dryRun = args.includes("--dry-run");
const [mode, run] = args.filter((a) => !a.startsWith("--"));

let where;
if (mode === "smoke" && /^[a-z0-9]{4,20}$/.test(run ?? "")) {
  where = `ua_raw LIKE 'ElevIQ-Smoke/1.0 smoke-${run}-%'`;
} else if (mode === "tests" && !run) {
  where = `path LIKE '/t/%'`;
} else {
  console.error("usage: mark-internal.mjs [--local] [--dry-run] smoke <run> | tests");
  process.exit(2);
}
where += " AND internal = 0";

const d1 = (sql) =>
  JSON.parse(
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "eleviq-site-log", local ? "--local" : "--remote", "--config", "site-logger/wrangler.toml", "--json", "--command", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ),
  )[0];

const rows = d1(`SELECT ts, path, ua_raw FROM page_views WHERE ${where} ORDER BY ts`).results ?? [];
for (const r of rows) console.log(`  ${r.ts}  ${r.path}  ${r.ua_raw ?? "(browser UA, not stored)"}`);
if (dryRun || rows.length === 0) {
  console.log(`${rows.length} row(s) would be marked internal${dryRun ? " (dry run)" : ""}.`);
  process.exit(0);
}
const res = d1(`UPDATE page_views SET internal = 1 WHERE ${where}`);
console.log(`${res.meta?.changes ?? "?"} row(s) marked internal.`);
