/**
 * Build step for the demo site (docs/, served by GitHub Pages).
 *
 *  1. Bundle web-bot-auth for the browser  -> docs/assets/agent-sign.js
 *  2. Copy the demo keypairs               -> docs/reference/*.jwk.json
 *     (source of truth: gateway/keys/ — the console signs with them,
 *      and /reference/ serves them for download)
 *
 * Run `npm run build`, then commit the results — GitHub Pages serves the
 * committed files directly (no CI).
 */
import * as esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [join(ROOT, "build/agent-sign.entry.js")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  outfile: join(ROOT, "docs/assets/agent-sign.js"),
  legalComments: "none",
});
console.log("bundled  docs/assets/agent-sign.js");

const PUBLISHED_KEYS = ["demo-agent", "untrusted-agent"];
await mkdir(join(ROOT, "docs/reference"), { recursive: true });
for (const name of PUBLISHED_KEYS) {
  await cp(join(ROOT, `gateway/keys/${name}.jwk.json`), join(ROOT, `docs/reference/${name}.jwk.json`));
}
console.log(`copied   ${PUBLISHED_KEYS.length} demo keys  gateway/keys/ -> docs/reference/`);
