import assert from "node:assert/strict";
import { test } from "node:test";
import { sign, generateNonce } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { createSignatureChecker } from "../signature-check.ts";
import { OPERATORS, type Operator } from "../signatures.ts";

import demoAgent from "../../gateway/keys/demo-agent.jwk.json" with { type: "json" };
import agentB from "../../gateway/keys/demo-agent-b.jwk.json" with { type: "json" };
import untrusted from "../../gateway/keys/untrusted-agent.jwk.json" with { type: "json" };

const T0 = new Date("2026-11-17T10:00:00Z");
const URL_ = "https://eleviq.solutions/services/";

/** A stand-in "chatgpt.com" whose directory serves agent B's public key. */
const OPS: Operator[] = [
  { origin: "https://chatgpt.com", operator: "OpenAI", product: "ChatGPT agent", kind: "ai-assistant" },
  ...OPERATORS.filter((o) => o.demo),
];

function publicOf(jwk: Record<string, unknown>) {
  const { d: _d, ...pub } = jwk;
  return pub;
}

async function signed(jwk: object, opts: { agent?: string | null; url?: string; created?: Date; expires?: Date } = {}) {
  const url = opts.url ?? URL_;
  const headers: Record<string, string> = {};
  const agent = opts.agent === undefined ? "https://eleviq.solutions" : opts.agent;
  if (agent) headers["Signature-Agent"] = `sig1="${agent}"`;
  const created = opts.created ?? T0;
  const fields = await sign(new Request(url, { headers }), {
    signer: await signerFromJWK(jwk as JsonWebKey),
    created,
    expires: opts.expires ?? new Date(created.getTime() + 5 * 60_000),
    nonce: generateNonce(),
    target: "@target-uri",
    label: "sig1",
  });
  return { ...headers, "Signature-Input": fields.signatureInput, Signature: fields.signature };
}

function req(headers: Record<string, string>, url = URL_) {
  return new Request(url, { headers });
}

/** Fetch stub: serves `keys` (or throws) and counts calls. */
function directory(keys: () => object[] | Error) {
  const stub = {
    calls: 0,
    fetch: (async (input: RequestInfo | URL) => {
      stub.calls++;
      assert.equal(String(input), "https://chatgpt.com/.well-known/http-message-signatures-directory");
      const k = keys();
      if (k instanceof Error) throw k;
      return new Response(JSON.stringify({ keys: k }), { status: 200 });
    }) as typeof fetch,
  };
  return stub;
}

const neverFetch = (async () => {
  throw new Error("must not fetch");
}) as unknown as typeof fetch;

function checker(over: Partial<Parameters<typeof createSignatureChecker>[0]> = {}) {
  let t = T0.getTime();
  const c = createSignatureChecker({ operators: OPS, acceptDemo: true, fetch: neverFetch, now: () => new Date(t), ...over });
  return { c, advance: (ms: number) => (t += ms) };
}

test("unsigned → none", async () => {
  const { c } = checker();
  assert.equal((await c.check(req({}))).sig_status, "none");
});

test("demo key with acceptDemo → valid, sig_agent is the demo operator", async () => {
  const { c } = checker();
  const r = await c.check(req(await signed(demoAgent)));
  assert.equal(r.sig_status, "valid");
  assert.equal(r.sig_agent, "eleviq.solutions");
  assert.equal(r.operator?.product, "ElevIQ demo agent");
});

test("demo key without acceptDemo → unverifiable (client sites)", async () => {
  const { c } = checker({ acceptDemo: false });
  assert.equal((await c.check(req(await signed(demoAgent)))).sig_status, "unverifiable");
});

test("tampered: same headers on another URL → invalid", async () => {
  const { c } = checker();
  const r = await c.check(req(await signed(demoAgent), "https://eleviq.solutions/other/"));
  assert.equal(r.sig_status, "invalid");
});

test("tampered signature bytes → invalid", async () => {
  const { c } = checker();
  const h = await signed(demoAgent);
  h.Signature = h.Signature.replace(/:(.)/, (_m, ch) => ":" + (ch === "A" ? "B" : "A"));
  assert.equal((await c.check(req(h))).sig_status, "invalid");
});

test("expired → invalid", async () => {
  const { c } = checker();
  const old = new Date(T0.getTime() - 3 * 3600_000);
  const r = await c.check(req(await signed(demoAgent, { created: old, expires: new Date(old.getTime() + 60_000) })));
  assert.equal(r.sig_status, "invalid");
});

test("unsupported algorithm → unverifiable", async () => {
  const { c } = checker();
  const h = await signed(demoAgent);
  h["Signature-Input"] = h["Signature-Input"].replace(/alg="[^"]+"/, 'alg="hmac-sha256"');
  assert.equal((await c.check(req(h))).sig_status, "unverifiable");
});

test("Signature-Agent not on the allow-list → unverifiable, never fetched", async () => {
  const { c } = checker(); // neverFetch throws if called
  const r = await c.check(req(await signed(agentB, { agent: "https://agent.example" })));
  assert.equal(r.sig_status, "unverifiable");
  assert.equal(r.sig_agent, "agent.example");
});

test("allow-listed operator, directory unreachable → unverifiable", async () => {
  const dir = directory(() => new Error("ECONNREFUSED"));
  const { c } = checker({ fetch: dir.fetch });
  const r = await c.check(req(await signed(agentB, { agent: "https://chatgpt.com" })));
  assert.equal(r.sig_status, "unverifiable");
  assert.equal(r.sig_agent, "chatgpt.com");
});

test("allow-listed operator, key in directory → valid; cached within TTL", async () => {
  const dir = directory(() => [publicOf(agentB)]);
  const { c, advance } = checker({ fetch: dir.fetch, ttlMs: 60_000 });
  const r = await c.check(req(await signed(agentB, { agent: "https://chatgpt.com" })));
  assert.equal(r.sig_status, "valid");
  assert.equal(r.sig_agent, "chatgpt.com");
  assert.equal(dir.calls, 1);
  advance(30_000);
  assert.equal((await c.check(req(await signed(agentB, { agent: "https://chatgpt.com", created: new Date(T0.getTime() + 30_000) })))).sig_status, "valid");
  assert.equal(dir.calls, 1, "served from cache");
  advance(60_000);
  assert.equal((await c.check(req(await signed(agentB, { agent: "https://chatgpt.com", created: new Date(T0.getTime() + 90_000) })))).sig_status, "valid");
  assert.equal(dir.calls, 2, "refetched after TTL");
});

test("keyid missing → exactly one refetch, then invalid", async () => {
  const dir = directory(() => [publicOf(agentB)]);
  const { c } = checker({ fetch: dir.fetch });
  // Warm the cache.
  await c.check(req(await signed(agentB, { agent: "https://chatgpt.com" })));
  assert.equal(dir.calls, 1);
  const r = await c.check(req(await signed(untrusted, { agent: "https://chatgpt.com" })));
  assert.equal(r.sig_status, "invalid");
  assert.equal(dir.calls, 2);
});

test("keyid missing on a cold cache → single fetch, invalid", async () => {
  const dir = directory(() => [publicOf(agentB)]);
  const { c } = checker({ fetch: dir.fetch });
  assert.equal((await c.check(req(await signed(untrusted, { agent: "https://chatgpt.com" })))).sig_status, "invalid");
  assert.equal(dir.calls, 1);
});

test("key rotated in: missing in cache, present on refetch → valid", async () => {
  let keys: object[] = [publicOf(untrusted)];
  const dir = directory(() => keys);
  const { c } = checker({ fetch: dir.fetch });
  await c.check(req(await signed(untrusted, { agent: "https://chatgpt.com" })));
  keys = [publicOf(untrusted), publicOf(agentB)];
  assert.equal((await c.check(req(await signed(agentB, { agent: "https://chatgpt.com" })))).sig_status, "valid");
  assert.equal(dir.calls, 2);
});

test("keyid missing and refetch fails → unverifiable", async () => {
  let fail = false;
  const dir = directory(() => (fail ? new Error("timeout") : [publicOf(agentB)]));
  const { c } = checker({ fetch: dir.fetch });
  await c.check(req(await signed(agentB, { agent: "https://chatgpt.com" })));
  fail = true;
  assert.equal((await c.check(req(await signed(untrusted, { agent: "https://chatgpt.com" })))).sig_status, "unverifiable");
});
