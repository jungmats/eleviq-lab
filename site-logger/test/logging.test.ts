import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { sign, generateNonce } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { logVisit } from "../src/features/logging/index.ts";
import type { Env } from "../src/lib/env.ts";

import demoAgent from "../../gateway/keys/demo-agent.jwk.json" with { type: "json" };

const PAGE = "https://eleviq.solutions/services/";
const TOKEN = "test-token-7f3a9c2e5b1d4086a2c4e6f8b0d2f4a6";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";

const COLUMNS = [
  "ts", "path", "visitor", "visitor_category", "cf_bot_category", "referrer_agent", "country",
  "ua_match", "ua_raw", "sig_status", "sig_agent", "referral_signal", "internal",
] as const;
type Row = Record<(typeof COLUMNS)[number], unknown>;

// --- console.error capture -------------------------------------------------
let errors: string[] = [];
const realError = console.error;
beforeEach(() => {
  errors = [];
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
});
afterEach(() => {
  console.error = realError;
});

// --- fakes -----------------------------------------------------------------
function fakeEnv(opts: { token?: string; demo?: boolean; failWrite?: boolean } = {}) {
  const rows: Row[] = [];
  const sql: string[] = [];
  const DB = {
    prepare(query: string) {
      sql.push(query);
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (opts.failWrite) throw new Error("D1_ERROR: database is locked");
              rows.push(Object.fromEntries(COLUMNS.map((c, i) => [c, values[i]])) as Row);
              return { success: true };
            },
          };
        },
      };
    },
  };
  const env = {
    DB,
    ELEVIQ_INTERNAL_TOKEN: opts.token,
    ACCEPT_DEMO_SIGNATURES: opts.demo === false ? "false" : "true",
  } as unknown as Env;
  return { env, rows, sql };
}

function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} };
  return { ctx: ctx as unknown as ExecutionContext, settle: () => Promise.all(pending) };
}

function request(headers: Record<string, string>, opts: { url?: string; cf?: Record<string, unknown> } = {}) {
  const r = new Request(opts.url ?? PAGE, { headers });
  if (opts.cf) Object.defineProperty(r, "cf", { value: opts.cf });
  return r;
}

const html = () => new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } });

async function logOne(req: Request, envOpts: Parameters<typeof fakeEnv>[0] = {}): Promise<Row> {
  const { env, rows } = fakeEnv(envOpts);
  const { ctx, settle } = fakeCtx();
  logVisit(req, html(), env, ctx);
  await settle();
  assert.equal(rows.length, 1, `one row expected, errors: ${errors.join(" / ")}`);
  return rows[0];
}

async function demoSigned(): Promise<Record<string, string>> {
  const headers = { "Signature-Agent": `sig1="https://eleviq.solutions"`, "User-Agent": CHROME };
  const created = new Date();
  const fields = await sign(new Request(PAGE, { headers }), {
    signer: await signerFromJWK(demoAgent as unknown as JsonWebKey),
    created,
    expires: new Date(created.getTime() + 5 * 60_000),
    nonce: generateNonce(),
    target: "@target-uri",
    label: "sig1",
  });
  return { ...headers, "Signature-Input": fields.signatureInput, Signature: fields.signature };
}

// --- tests -----------------------------------------------------------------
test("a Chrome visit stores no User-Agent and no match", async () => {
  const row = await logOne(request({ "User-Agent": CHROME }));
  assert.equal(row.ua_raw, null);
  assert.equal(row.ua_match, null);
  assert.equal(row.sig_status, "none");
  assert.equal(row.internal, 0);
  assert.equal(row.path, "/services/");
});

test("GPTBot: name matched and User-Agent stored", async () => {
  const row = await logOne(request({ "User-Agent": GPTBOT }));
  assert.equal(row.ua_match, "GPTBot");
  assert.equal(row.ua_raw, GPTBOT);
});

test("an empty or missing User-Agent is stored as empty string", async () => {
  assert.equal((await logOne(request({ "User-Agent": "" }))).ua_raw, "");
  assert.equal((await logOne(request({}))).ua_raw, "");
});

test("a Chrome UA attested by Cloudflare is stored", async () => {
  const row = await logOne(request({ "User-Agent": CHROME }, { cf: { verifiedBotCategory: "AI Assistant", country: "US" } }));
  assert.equal(row.ua_raw, CHROME);
  assert.equal(row.cf_bot_category, "AI Assistant");
  assert.equal(row.country, "US");
});

test("a very long bot User-Agent is cut to 512 characters", async () => {
  const row = await logOne(request({ "User-Agent": "curl/8.0 " + "x".repeat(2000) }));
  assert.equal((row.ua_raw as string).length, 512);
});

test("utm_source=chatgpt.com is a ChatGPT referral by utm", async () => {
  const row = await logOne(request({ "User-Agent": CHROME }, { url: PAGE + "?utm_source=chatgpt.com" }));
  assert.equal(row.referrer_agent, "ChatGPT");
  assert.equal(row.referral_signal, "utm");
});

test("a Referer from chatgpt.com is a ChatGPT referral by referer", async () => {
  const row = await logOne(request({ "User-Agent": CHROME, Referer: "https://chatgpt.com/" }));
  assert.equal(row.referrer_agent, "ChatGPT");
  assert.equal(row.referral_signal, "referer");
});

test("internal: correct token 1, wrong token 0, secret unset 0", async () => {
  assert.equal((await logOne(request({ "User-Agent": CHROME, "X-ElevIQ-Internal": TOKEN }), { token: TOKEN })).internal, 1);
  assert.equal((await logOne(request({ "User-Agent": CHROME, "X-ElevIQ-Internal": TOKEN + "x" }), { token: TOKEN })).internal, 0);
  assert.equal((await logOne(request({ "User-Agent": CHROME, "X-ElevIQ-Internal": TOKEN.slice(0, 10) }), { token: TOKEN })).internal, 0);
  assert.equal((await logOne(request({ "User-Agent": CHROME, "X-ElevIQ-Internal": TOKEN }), {})).internal, 0);
  assert.equal((await logOne(request({ "User-Agent": CHROME }), { token: TOKEN })).internal, 0);
});

test("demo-signed request is valid with the demo setting on, vouched by eleviq.solutions", async () => {
  const row = await logOne(request(await demoSigned()), { demo: true });
  assert.equal(row.sig_status, "valid");
  assert.equal(row.sig_agent, "eleviq.solutions");
});

test("demo-signed request is unverifiable with the demo setting off", async () => {
  const row = await logOne(request(await demoSigned()), { demo: false });
  assert.equal(row.sig_status, "unverifiable");
});

test("a tampered signature is invalid", async () => {
  const headers = await demoSigned();
  const sig = headers.Signature;
  // Flip one base64 character inside the signature value.
  const i = sig.indexOf(":") + 5;
  headers.Signature = sig.slice(0, i) + (sig[i] === "A" ? "B" : "A") + sig.slice(i + 1);
  const row = await logOne(request(headers), { demo: true });
  assert.equal(row.sig_status, "invalid");
});

test("the token appears in no stored value and no error output", async () => {
  const { env, rows } = fakeEnv({ token: TOKEN, failWrite: true });
  const { ctx, settle } = fakeCtx();
  logVisit(request({ "User-Agent": "curl/8 " + TOKEN, "X-ElevIQ-Internal": TOKEN }), html(), env, ctx);
  await settle();
  assert.equal(rows.length, 0);
  assert.ok(errors.length > 0, "the failed write is reported");
  for (const e of errors) assert.ok(!e.includes(TOKEN), "token in error output");

  const ok = await logOne(request({ "User-Agent": CHROME, "X-ElevIQ-Internal": TOKEN }), { token: TOKEN });
  for (const v of Object.values(ok)) assert.ok(!String(v).includes(TOKEN), "token in a stored value");
});

test("a failing DB write never throws out of logVisit", async () => {
  const { env } = fakeEnv({ failWrite: true });
  const { ctx, settle } = fakeCtx();
  assert.doesNotThrow(() => logVisit(request({ "User-Agent": CHROME }), html(), env, ctx));
  await assert.doesNotReject(settle());
});

test("logVisit returns before the write happens", async () => {
  const { env, rows } = fakeEnv();
  const { ctx, settle } = fakeCtx();
  logVisit(request({ "User-Agent": CHROME }), html(), env, ctx);
  assert.equal(rows.length, 0, "nothing written synchronously");
  await settle();
  assert.equal(rows.length, 1);
});

test("non-page responses are not logged", async () => {
  const { env, rows } = fakeEnv();
  const { ctx, settle } = fakeCtx();
  logVisit(request({ "User-Agent": CHROME }), new Response("x", { headers: { "content-type": "text/css" } }), env, ctx);
  await settle();
  assert.equal(rows.length, 0);
});

test("the INSERT names all LOG-1 columns", async () => {
  const { env, sql } = fakeEnv();
  const { ctx, settle } = fakeCtx();
  logVisit(request({ "User-Agent": CHROME }), html(), env, ctx);
  await settle();
  for (const c of COLUMNS) assert.match(sql[0], new RegExp(`\\b${c}\\b`), c);
});
