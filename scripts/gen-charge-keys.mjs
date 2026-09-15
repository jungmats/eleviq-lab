/**
 * Generate the two Base Sepolia keypairs Demo 4 (Charge) uses.
 *
 *   node scripts/gen-charge-keys.mjs
 *
 * Two very different roles, same as a real x402 merchant would have:
 *
 *   - "agent"    — the DEMO PAYER. A throwaway keypair, published on purpose
 *                  (gateway/keys/charge-agent.json, copied to
 *                  docs/reference/ by `npm run build`) so anyone can play the
 *                  paying agent — same convention as gateway/keys/demo-agent.jwk.json
 *                  for Web Bot Auth. Funded with testnet USDC via a faucet.
 *
 *   - "relayer"  — OUR side: the merchant's receiving address (payTo) AND
 *                  the facilitator's relayer wallet that submits the
 *                  settlement transaction and pays its gas (see PLAN.md's
 *                  "self-hosted facilitator" decision — one Worker plays
 *                  both roles, so one wallet is enough). Its private key is
 *                  NEVER committed — printed once, put in gateway/.dev.vars
 *                  for local dev and `wrangler secret put` for the deployed
 *                  Worker, exactly like RESEND_API_KEY. Funded with testnet
 *                  ETH (for gas) via a faucet; receives testnet USDC
 *                  automatically as payments settle.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEYS_DIR = join(ROOT, "gateway/keys");
mkdirSync(KEYS_DIR, { recursive: true });

function makeKeypair() {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  return { privateKey, address };
}

const agent = makeKeypair();
const relayer = makeKeypair();

writeFileSync(
  join(KEYS_DIR, "charge-agent.json"),
  JSON.stringify({ address: agent.address, privateKey: agent.privateKey }, null, 2) + "\n",
);
console.log(`wrote    ${join(KEYS_DIR, "charge-agent.json")}  (public demo payer — committed on purpose)`);
console.log();
console.log("Relayer / payTo keypair — DO NOT COMMIT. Set it up as a secret:");
console.log();
console.log(`  address (public, safe to share — this is where payments land):`);
console.log(`    ${relayer.address}`);
console.log();
console.log(`  local dev — add this line to gateway/.dev.vars (gitignored):`);
console.log(`    CHARGE_RELAYER_KEY=${relayer.privateKey}`);
console.log();
console.log(`  deployed  — run:`);
console.log(`    echo "${relayer.privateKey}" | npx wrangler secret put CHARGE_RELAYER_KEY --config gateway/wrangler.toml`);
console.log();
console.log("Fund BOTH addresses with Base Sepolia testnet assets before testing:");
console.log(`  agent   ${agent.address}  needs testnet USDC (what it pays with)`);
console.log(`  relayer ${relayer.address}  needs testnet ETH (gas for settling) — it then`);
console.log(`          collects the USDC agents pay, since it's also payTo`);
