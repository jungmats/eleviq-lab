/**
 * Generate the Ed25519 JWK keypairs the lab uses.
 *
 *   node scripts/gen-keys.mjs           # regenerate every key in keys/
 *   node scripts/gen-keys.mjs openai    # regenerate just keys/openai.jwk.json
 *
 * The keys in keys/ are committed DEMO keys — throwaway, published on purpose so
 * anyone can exercise the demo. For a real deployment, generate fresh keys, keep
 * the private half in a Cloudflare secret, and publish only the public half in
 * the directory.
 */
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEYS_DIR = join(ROOT, "keys");

// name -> a stable kid label (purely cosmetic; identity comes from the thumbprint)
const KEYS = {
  "openai": "eleviq-lab-demo-openai",
  "anthropic": "eleviq-lab-demo-anthropic",
  "perplexity": "eleviq-lab-demo-perplexity",
  "demo-agent": "eleviq-lab-demo-agent",
  "untrusted-agent": "eleviq-lab-untrusted-agent",
};

function makeKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const priv = privateKey.export({ format: "jwk" }); // { kty, crv, x, d }
  return { kty: priv.kty, crv: priv.crv, alg: "EdDSA", kid, x: priv.x, d: priv.d };
}

mkdirSync(KEYS_DIR, { recursive: true });
const only = process.argv.slice(2);
const targets = only.length ? only : Object.keys(KEYS);

for (const name of targets) {
  if (!(name in KEYS)) {
    console.error(`unknown key "${name}" — known: ${Object.keys(KEYS).join(", ")}`);
    process.exit(1);
  }
  const jwk = makeKey(KEYS[name]);
  const file = join(KEYS_DIR, `${name}.jwk.json`);
  writeFileSync(file, JSON.stringify(jwk, null, 2) + "\n");
  console.log(`wrote ${file}`);
}
