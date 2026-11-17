import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UA_SIGNATURES,
  classifyReferral,
  isBrowserUserAgent,
  mapCloudflareCategory,
  matchUserAgent,
  operatorByHost,
  OPERATORS,
} from "../signatures.ts";

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

test("every signature matches its own pattern and resolves to itself", () => {
  for (const sig of UA_SIGNATURES) {
    assert.equal(matchUserAgent(`Mozilla/5.0 (compatible; ${sig.pattern}/1.0)`)?.name, sig.name, sig.name);
  }
});

test("more specific names win over names they contain", () => {
  assert.equal(matchUserAgent("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0")?.name, "ChatGPT-User");
  assert.equal(matchUserAgent("Mozilla/5.0 (compatible; GPTBot/1.2)")?.name, "GPTBot");
  assert.equal(matchUserAgent("Mozilla/5.0 (compatible; Claude-SearchBot/1.0)")?.name, "Claude-SearchBot");
  assert.equal(matchUserAgent("Mozilla/5.0 (compatible; ClaudeBot/1.0)")?.name, "ClaudeBot");
  assert.equal(matchUserAgent("Mozilla/5.0 (compatible; bingbot/2.0)")?.name, "Bingbot");
});

test("no match for browsers, libraries and empty", () => {
  assert.equal(matchUserAgent(CHROME), null);
  assert.equal(matchUserAgent("python-requests/2.32"), null);
  assert.equal(matchUserAgent(""), null);
  assert.equal(matchUserAgent(null), null);
});

test("cfVerifies reflects the 2026-11-17 decision", () => {
  const verified = UA_SIGNATURES.filter((s) => s.cfVerifies).map((s) => s.name).sort();
  assert.deepEqual(verified, [
    "Amazonbot", "Applebot", "Bingbot", "ChatGPT-User", "ClaudeBot", "DuckDuckBot",
    "GPTBot", "Googlebot", "OAI-SearchBot", "facebookexternalhit",
  ].sort());
});

test("browser-looking: real browsers yes; libraries, automation and empty no", () => {
  assert.equal(isBrowserUserAgent(CHROME), true);
  assert.equal(isBrowserUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"), true);
  assert.equal(isBrowserUserAgent(CHROME.replace("Chrome/", "HeadlessChrome/")), false);
  assert.equal(isBrowserUserAgent(CHROME + " Chrome-Lighthouse"), false);
  assert.equal(isBrowserUserAgent("python-requests/2.32"), false);
  assert.equal(isBrowserUserAgent("curl/8.7.1"), false);
  assert.equal(isBrowserUserAgent("Mozilla/5.0 (compatible; AgentReadinessBot/1.0; mode=c)"), false);
  assert.equal(isBrowserUserAgent("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot"), false);
  assert.equal(isBrowserUserAgent(""), false);
  assert.equal(isBrowserUserAgent(null), false);
});

test("every Cloudflare category observed in the log maps as CLS-2 says", () => {
  assert.equal(mapCloudflareCategory("AI Assistant"), "ai-assistant");
  assert.equal(mapCloudflareCategory("AI Search"), "search");
  assert.equal(mapCloudflareCategory("Search Engine Crawler"), "search");
  assert.equal(mapCloudflareCategory("AI Crawler"), "ai-training");
  for (const c of ["Search Engine Optimization", "Monitoring & Analytics", "Page Preview", "Feed Fetcher", "Webhooks"]) {
    assert.equal(mapCloudflareCategory(c), "other-bot", c);
  }
  assert.equal(mapCloudflareCategory(""), null);
  assert.equal(mapCloudflareCategory(null), null);
});

test("referral by Referer, by utm_source, Referer first", () => {
  assert.deepEqual(classifyReferral("https://chatgpt.com/c/abc", "https://eleviq.solutions/"), { by: "ChatGPT", signal: "referer" });
  assert.deepEqual(classifyReferral(null, "https://eleviq.solutions/?utm_source=chatgpt.com"), { by: "ChatGPT", signal: "utm" });
  assert.deepEqual(classifyReferral(null, "https://eleviq.solutions/?utm_source=Perplexity"), { by: "Perplexity", signal: "utm" });
  assert.deepEqual(
    classifyReferral("https://claude.ai/chat/1", "https://eleviq.solutions/?utm_source=chatgpt.com"),
    { by: "Claude", signal: "referer" },
  );
  assert.equal(classifyReferral("https://www.google.com/", "https://eleviq.solutions/?utm_source=newsletter"), null);
  assert.equal(classifyReferral("not a url", null), null);
});

test("operator allow-list lookups by host or origin", () => {
  assert.equal(operatorByHost("chatgpt.com")?.operator, "OpenAI");
  assert.equal(operatorByHost("https://chatgpt.com")?.product, "ChatGPT agent");
  assert.equal(operatorByHost("evil.example"), null);
  assert.equal(operatorByHost(null), null);
});

test("no private key material in the allow-list", () => {
  for (const op of OPERATORS) for (const k of op.localKeys ?? []) assert.equal("d" in k, false, op.origin);
});
