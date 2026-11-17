import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker from "../src/index.ts";
import type { Env } from "../src/lib/env.ts";

const TOKEN = "test-token-0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a";
const BODY = "<!doctype html><html><body>origin page — é</body></html>";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubOrigin() {
  const seen: Request[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input as RequestInfo, init));
    return new Response(BODY, { headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;
  return seen;
}

function env(): Env {
  const DB = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) };
  return { DB, ELEVIQ_INTERNAL_TOKEN: TOKEN, ACCEPT_DEMO_SIGNATURES: "true" } as unknown as Env;
}

function ctx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext,
    settle: () => Promise.all(pending),
  };
}

test("the internal header is stripped before the origin fetch; the body is passed through unchanged", async () => {
  const seen = stubOrigin();
  const c = ctx();
  const res = await worker.fetch(
    new Request("https://eleviq.solutions/", { headers: { "X-ElevIQ-Internal": TOKEN, "User-Agent": "UnitTest/1", Accept: "text/html" } }),
    env(),
    c.ctx,
  );
  await c.settle();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.get("X-ElevIQ-Internal"), null);
  assert.equal(seen[0].headers.get("User-Agent"), "UnitTest/1", "other headers kept");
  assert.equal(seen[0].url, "https://eleviq.solutions/");
  assert.equal(await res.text(), BODY);
});

test("without the internal header the request reaches the origin as is", async () => {
  const seen = stubOrigin();
  const c = ctx();
  const req = new Request("https://eleviq.solutions/", { headers: { "User-Agent": "UnitTest/1" } });
  const res = await worker.fetch(req, env(), c.ctx);
  await c.settle();
  assert.equal(seen[0].headers.get("User-Agent"), "UnitTest/1");
  assert.equal(await res.text(), BODY);
});
