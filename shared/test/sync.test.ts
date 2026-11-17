import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/sync-shared.mjs");

function run(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

test("sync copies sources with a GENERATED header and a manifest; --check passes, then catches an edit", () => {
  const dir = mkdtempSync(join(tmpdir(), "shared-sync-"));
  try {
    execFileSync(process.execPath, [SCRIPT, dir]);
    const names = readdirSync(dir).sort();
    assert.ok(names.includes("derive.ts") && names.includes("legend.fr.json") && names.includes("SHARED_MANIFEST.json"));
    assert.ok(!names.includes("test"), "tests are not copied");
    assert.ok(!names.includes("tsconfig.json"), "tsconfig is not copied");
    assert.match(readFileSync(join(dir, "derive.ts"), "utf8"), /^\/\/ GENERATED from eleviq-lab\/shared/);

    assert.equal(run("--check", dir).status, 0);
    appendFileSync(join(dir, "derive.ts"), "\n// hand edit\n");
    const r = run("--check", dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /differs: derive\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
