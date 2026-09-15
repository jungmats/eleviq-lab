/**
 * Build step for the demo site (docs/, served by GitHub Pages).
 *
 *  1. Bundle web-bot-auth for the browser  -> docs/assets/agent-sign.js
 *  2. Bundle viem (reads + signing) for the browser -> docs/assets/charge-sign.js
 *  3. Copy the demo keypairs               -> docs/reference/*.json
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

await esbuild.build({
  entryPoints: [join(ROOT, "build/charge-sign.entry.js")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  outfile: join(ROOT, "docs/assets/charge-sign.js"),
  legalComments: "none",
});
console.log("bundled  docs/assets/charge-sign.js");

await mkdir(join(ROOT, "docs/reference"), { recursive: true });

const PUBLISHED_KEYS = ["demo-agent", "untrusted-agent"];
for (const name of PUBLISHED_KEYS) {
  await cp(join(ROOT, `gateway/keys/${name}.jwk.json`), join(ROOT, `docs/reference/${name}.jwk.json`));
}
console.log(`copied   ${PUBLISHED_KEYS.length} demo keys  gateway/keys/ -> docs/reference/`);

// Demo 4 (Charge)'s demo PAYER wallet — published on purpose, same reasoning
// as demo-agent.jwk.json above. NOT gateway/keys/charge-relayer* — that key
// is a Cloudflare secret and never touches this repo. See
// scripts/gen-charge-keys.mjs.
await cp(join(ROOT, "gateway/keys/charge-agent.json"), join(ROOT, "docs/reference/charge-agent.json"));
console.log("copied   1 demo key    gateway/keys/charge-agent.json -> docs/reference/");
