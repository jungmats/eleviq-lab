import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker from "../src/index.ts";
import { testId, testPage, testPhrase } from "../src/features/test-path.ts";
import type { Env } from "../src/lib/env.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("valid ids are recognised; anything else is not", () => {
  const id = (p: string, method = "GET") => testId(new Request(`https://eleviq.solutions${p}`, { method }));
  assert.equal(id("/t/asm1-chatgpt-k3f9"), "asm1-chatgpt-k3f9");
  assert.equal(id("/t/asm1-chatgpt-k3f9/"), "asm1-chatgpt-k3f9");
  assert.equal(id("/t/abc"), null, "too short");
  assert.equal(id("/t/ABCD"), null, "upper case");
  assert.equal(id("/t/a.b.c.d"), null);
  assert.equal(id("/t/x".padEnd(50, "x")), null, "too long");
  assert.equal(id("/t/abcd/more"), null);
  assert.equal(id("/tt/abcd"), null);
  assert.equal(id("/t/abcd", "POST"), null);
});

test("the phrase is deterministic per id and differs between ids", async () => {
  const a = await testPhrase("asm1-chatgpt-k3f9");
  assert.match(a, /^[a-z]+-[a-z]+-\d{4}$/);
  assert.equal(await testPhrase("asm1-chatgpt-k3f9"), a);
  assert.notEqual(await testPhrase("asm1-claude-k3f9"), a);
});

test("the page is noindex, uncached HTML carrying the id and its phrase", async () => {
  const res = (await testPage(new Request("https://eleviq.solutions/t/selftest-0001")))!;
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /text\/html/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("x-robots-tag")!, /noindex/);
  const body = await res.text();
  assert.match(body, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(body.includes("selftest-0001"));
  assert.ok(body.includes(await testPhrase("selftest-0001")));
});

function run(path: string) {
  const fetched: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input instanceof Request ? input.url : input));
    return new Response("origin", { status: 404, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const rows: unknown[][] = [];
  const DB = { prepare: () => ({ bind: (...v: unknown[]) => ({ run: async () => void rows.push(v) }) }) };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const env = { DB, ACCEPT_DEMO_SIGNATURES: "true" } as unknown as Env;
  return { fetched, rows, settle: () => Promise.all(pending), res: worker.fetch(new Request(`https://eleviq.solutions${path}`, { headers: { "User-Agent": "curl/8.4" } }), env, ctx) };
}

test("a test-path request never reaches the origin and is logged as a page view", async () => {
  const r = run("/t/selftest-0002");
  const res = await r.res;
  await r.settle();
  assert.equal(res.status, 200);
  assert.deepEqual(r.fetched, [], "no origin fetch");
  assert.equal(r.rows.length, 1, "logged");
  assert.equal(r.rows[0][1], "/t/selftest-0002", "path column");
});

test("other paths under /t/ go to the origin as before", async () => {
  const r = run("/t/x");
  const res = await r.res;
  await r.settle();
  assert.equal(res.status, 404);
  assert.equal(r.fetched.length, 1);
});
