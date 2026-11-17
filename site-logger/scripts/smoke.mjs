#!/usr/bin/env node
/**
 * Production smoke test for the site logger (phase 2, AC-3 / AC-4 / AC-6).
 *
 *   node site-logger/scripts/smoke.mjs [base-url]
 *
 * Sends seven requests to eleviq.solutions, one per case, each to its own page so
 * its row can be found by path + time window. Prints the start time and the
 * cases as JSON — never the token. Rows are checked afterwards with a SELECT.
 *
 * The token is read from ~/.config/eleviq/internal-tokens.env and never sent:
 * requests carry a short-lived marker made with it (shared/internal-marker.ts).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sign, generateNonce } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { createInternalMarker } from "../../shared/internal-marker.ts";

const BASE = process.argv[2] ?? "https://eleviq.solutions";
const here = dirname(fileURLToPath(import.meta.url));
const demoKey = JSON.parse(readFileSync(join(here, "../../gateway/keys/demo-agent.jwk.json"), "utf8"));

function readToken() {
  const text = readFileSync(join(homedir(), ".config/eleviq/internal-tokens.env"), "utf8");
  const line = text.split("\n").find((l) => l.startsWith("ELEVIQ_INTERNAL_TOKEN="));
  if (!line) throw new Error("ELEVIQ_INTERNAL_TOKEN missing from internal-tokens.env");
  return line.slice("ELEVIQ_INTERNAL_TOKEN=".length).trim();
}

const TOKEN = readToken();
const RUN = Date.now().toString(36);
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";

async function signedHeaders(url, ua) {
  const headers = { "Signature-Agent": `sig1="https://eleviq.solutions"`, "User-Agent": ua };
  const created = new Date();
  const f = await sign(new Request(url, { headers }), {
    signer: await signerFromJWK(demoKey),
    created,
    expires: new Date(created.getTime() + 5 * 60_000),
    nonce: generateNonce(),
    target: "@target-uri",
    label: "sig1",
  });
  return { ...headers, "Signature-Input": f.signatureInput, Signature: f.signature };
}

function tamper(sig) {
  const i = sig.indexOf(":") + 5;
  return sig.slice(0, i) + (sig[i] === "A" ? "B" : "A") + sig.slice(i + 1);
}

const HOST = new URL(BASE).host;
const internal = { "X-ElevIQ-Internal": await createInternalMarker(TOKEN, HOST) };
// A marker made with a token of the same shape that is not the token.
const wrong = { "X-ElevIQ-Internal": await createInternalMarker("0".repeat(64), HOST) };
// Never send the token itself: Cloudflare would keep it in its request logs.
// That the raw token is rejected is covered by the unit tests.
const expired = { "X-ElevIQ-Internal": await createInternalMarker(TOKEN, HOST, new Date(Date.now() - 3600_000)) };

const cases = [
  { id: "a", what: "browser UA", path: "/", headers: { "User-Agent": CHROME, ...internal } },
  { id: "b", what: "GPTBot UA", path: "/technologies.html", headers: { "User-Agent": `${GPTBOT} smoke-${RUN}-b`, ...internal } },
  { id: "c", what: "empty UA", path: "/booking/", headers: { "User-Agent": "", ...internal } },
  { id: "d", what: "demo-key signed", path: "/fr/", sign: true, headers: { ...internal } },
  { id: "e", what: "demo-key signed, tampered", path: "/fr/technologies.html", sign: true, tampered: true, headers: { ...internal } },
  { id: "f", what: "wrong token, browser UA", path: "/services/ai-agent-readiness.html", headers: { "User-Agent": CHROME, ...wrong } },
  { id: "g", what: "utm_source=chatgpt.com, browser UA", path: "/fr/booking/", query: "?utm_source=chatgpt.com", headers: { "User-Agent": CHROME, ...internal } },
  { id: "i", what: "expired marker (rejected)", path: "/fr/services/ai-agent-readiness.html", headers: { "User-Agent": `ElevIQ-Smoke/1.0 smoke-${RUN}-i`, ...expired } },
];

const start = new Date().toISOString();
const out = [];
for (const c of cases) {
  const url = BASE + c.path + (c.query ?? "");
  let headers = { ...c.headers };
  if (c.sign) {
    const s = await signedHeaders(url, `ElevIQ-Smoke/1.0 smoke-${RUN}-${c.id}`);
    if (c.tampered) s.Signature = tamper(s.Signature);
    headers = { ...headers, ...s };
  }
  const res = await fetch(url, { headers, redirect: "manual" });
  await res.arrayBuffer();
  out.push({ id: c.id, what: c.what, path: c.path, status: res.status });
}
console.log(JSON.stringify({ run: RUN, start, end: new Date().toISOString(), cases: out }, null, 2));
