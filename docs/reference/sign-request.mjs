/**
 * ElevIQ Lab — Web Bot Auth reference signer.
 *
 * The real client-side code path an agent implements: hold an Ed25519 key, sign
 * the request per RFC 9421, send it. ~40 lines, no framework.
 *
 * Setup (see https://lab.eleviq.solutions/identity/ section 5):
 *   mkdir wba && cd wba
 *   npm init -y && npm install web-bot-auth
 *   curl -O https://lab.eleviq.solutions/reference/sign-request.mjs
 *   curl -O https://lab.eleviq.solutions/reference/demo-agent.jwk.json
 *
 * Use:
 *   node sign-request.mjs --url <gateway URL> [--key demo-agent.jwk.json] [--send]
 *   (gateway: https://eleviq-lab-gateway.gateway-worker.workers.dev/api/identity/price-list)
 *
 *   --url    the URL to call (required)
 *   --key    path to an Ed25519 JWK with a private component (default demo-agent.jwk.json)
 *   --send   actually send the request and print the response;
 *            without it, print a ready-to-run curl instead
 *
 * Try --key untrusted-agent.jwk.json to see the unknown-key rejection.
 */
import { readFileSync } from "node:fs";
import { sign, generateNonce } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const url = arg("url");
const keyPath = arg("key", "demo-agent.jwk.json");
const doSend = arg("send", false);

if (!url) {
  console.error("usage: node sign-request.mjs --url <URL> [--key <jwk>] [--send]");
  process.exit(1);
}

const jwk = JSON.parse(readFileSync(keyPath, "utf8"));
const origin = new URL(url).origin;
const signatureAgent = `sig1="${origin}";type=directory`;

const now = new Date();
const fields = await sign(new Request(url, { headers: { "Signature-Agent": signatureAgent } }), {
  signer: await signerFromJWK(jwk),
  created: now,
  expires: new Date(now.getTime() + 5 * 60_000),
  nonce: generateNonce(),
  target: "@target-uri",
  label: "sig1",
});

const headers = {
  "Signature-Input": fields.signatureInput,
  Signature: fields.signature,
  "Signature-Agent": signatureAgent,
};

if (doSend) {
  const res = await fetch(url, { headers });
  console.error(`${res.status} ${res.statusText}\n`);
  console.log(await res.text());
} else {
  console.log(`curl -i '${url}' \\`);
  for (const [k, v] of Object.entries(headers)) console.log(`  -H '${k}: ${v}' \\`);
  console.log("  -H 'Accept: application/json'");
}
