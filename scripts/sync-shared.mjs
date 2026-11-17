#!/usr/bin/env node
/**
 * Copies eleviq-lab/shared (sources, not tests) into another repo, until the
 * code moves to one repository (agent-analytics/deployment-options.md).
 *
 *   node scripts/sync-shared.mjs <target-dir>           copy + write SHARED_MANIFEST.json
 *   node scripts/sync-shared.mjs --check <target-dir>   exit 1 if the copy differs from the source
 *
 * Each copied .ts file gets a "GENERATED — do not edit" header; the manifest
 * holds a sha256 per copied file so the target repo can test for hand edits.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../shared");
const HEADER = "// GENERATED from eleviq-lab/shared — do not edit here; run scripts/sync-shared.mjs\n";
const MANIFEST = "SHARED_MANIFEST.json";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** The files a target should contain: name → content. */
function expected() {
  const out = new Map();
  for (const name of readdirSync(SOURCE).sort()) {
    if (name.endsWith(".ts")) out.set(name, HEADER + readFileSync(join(SOURCE, name), "utf8"));
    else if (name.endsWith(".json") && name !== "tsconfig.json") out.set(name, readFileSync(join(SOURCE, name), "utf8"));
  }
  const manifest = Object.fromEntries([...out].map(([n, c]) => [n, sha256(c)]));
  out.set(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  return out;
}

function usage() {
  console.error("usage: node scripts/sync-shared.mjs [--check] <target-dir>");
  process.exit(2);
}

const args = process.argv.slice(2);
const check = args[0] === "--check";
const target = check ? args[1] : args[0];
if (!target) usage();
const dir = resolve(target);
const files = expected();

if (check) {
  const drift = [];
  for (const [name, content] of files) {
    const p = join(dir, name);
    if (!existsSync(p)) drift.push(`missing: ${name}`);
    else if (readFileSync(p, "utf8") !== content) drift.push(`differs: ${name}`);
  }
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) if (!files.has(name)) drift.push(`extra: ${name}`);
  }
  if (drift.length) {
    console.error(`shared copy in ${dir} is out of date:\n  ${drift.join("\n  ")}\nRun: node scripts/sync-shared.mjs ${target}`);
    process.exit(1);
  }
  console.log(`shared copy in ${dir} is up to date (${files.size} files)`);
} else {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(dir, name), content);
  console.log(`synced ${files.size} files to ${dir}`);
}
