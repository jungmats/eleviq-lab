import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveVisitor, signalKey, type VisitorClass, type VisitorSignals } from "../derive.ts";

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CHATGPT_USER = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot";

/** A new-format row as the phase 2 logger will write it (LOG-1, LOG-2). */
function row(over: VisitorSignals): VisitorSignals {
  return { ua_match: null, ua_raw: null, cf_bot_category: null, sig_status: "none", sig_agent: null, referrer_agent: null, referral_signal: null, internal: 0, ...over };
}

function expect(over: Partial<VisitorClass>): VisitorClass {
  return { kind: "people", level: null, method: null, name: null, flags: [], notes: [], referral: null, ...over };
}

// Requirements §6.2 — one entry per decision-table row.
const DECISION_TABLE: Array<[number, string, VisitorSignals, VisitorClass]> = [
  [1, "browser, nothing", row({}), expect({})],
  [2, "browser, AI Assistant", row({ ua_raw: CHROME, cf_bot_category: "AI Assistant" }),
    expect({ kind: "ai-assistant", level: "attested", method: "cloudflare", name: "AI Assistant" })],
  [3, "browser, AI Assistant, valid chatgpt.com", row({ ua_raw: CHROME, cf_bot_category: "AI Assistant", sig_status: "valid", sig_agent: "chatgpt.com" }),
    expect({ kind: "ai-assistant", level: "verified", method: "web-bot-auth", name: "ChatGPT agent" })],
  [4, "ChatGPT-User, any, valid", row({ ua_match: "ChatGPT-User", ua_raw: CHATGPT_USER, cf_bot_category: "AI Assistant", sig_status: "valid", sig_agent: "chatgpt.com" }),
    expect({ kind: "ai-assistant", level: "verified", method: "web-bot-auth", name: "ChatGPT-User" })],
  [5, "ChatGPT-User, AI Assistant, invalid", row({ ua_match: "ChatGPT-User", ua_raw: CHATGPT_USER, cf_bot_category: "AI Assistant", sig_status: "invalid", sig_agent: "chatgpt.com" }),
    expect({ kind: "ai-assistant", level: "attested", method: "cloudflare", name: "ChatGPT-User", flags: ["signature-invalid"] })],
  [6, "ChatGPT-User, none, invalid", row({ ua_match: "ChatGPT-User", ua_raw: CHATGPT_USER, sig_status: "invalid", sig_agent: "chatgpt.com" }),
    expect({ kind: "ai-assistant", level: "declared", method: "user-agent", name: "ChatGPT-User", flags: ["contradicted", "signature-invalid"] })],
  [7, "GPTBot, AI Crawler", row({ ua_match: "GPTBot", ua_raw: GPTBOT, cf_bot_category: "AI Crawler" }),
    expect({ kind: "ai-training", level: "attested", method: "cloudflare", name: "GPTBot" })],
  [8, "GPTBot, none", row({ ua_match: "GPTBot", ua_raw: GPTBOT }),
    expect({ kind: "ai-training", level: "declared", method: "user-agent", name: "GPTBot", flags: ["contradicted"] })],
  [9, "Perplexity-User, none", row({ ua_match: "Perplexity-User", ua_raw: "Mozilla/5.0 (compatible; Perplexity-User/1.0)" }),
    expect({ kind: "ai-assistant", level: "declared", method: "user-agent", name: "Perplexity-User" })],
  [10, "Bytespider, Search Engine Crawler", row({ ua_match: "Bytespider", ua_raw: "Mozilla/5.0 (compatible; Bytespider)", cf_bot_category: "Search Engine Crawler" }),
    expect({ kind: "search", level: "attested", method: "cloudflare", name: "Bytespider" })],
  [11, "browser, Page Preview", row({ ua_raw: CHROME, cf_bot_category: "Page Preview" }),
    expect({ kind: "other-bot", level: "attested", method: "cloudflare", name: "Page Preview" })],
  [12, "browser, signature from host not on allow-list", row({ sig_status: "unverifiable", sig_agent: "agent.example" }),
    expect({ kind: "unknown", level: "declared", method: "signature-agent", name: "agent.example", notes: ["sig-unchecked"] })],
  [13, "browser, invalid signature", row({ sig_status: "invalid", sig_agent: "chatgpt.com" }),
    expect({ flags: ["signature-invalid"] })],
  [14, "python-requests", row({ ua_raw: "python-requests/2.32.3" }), expect({ kind: "unknown" })],
  [15, "curl", row({ ua_raw: "curl/8.7.1" }), expect({ kind: "unknown" })],
  [16, "empty UA", row({ ua_raw: "" }), expect({ kind: "unknown" })],
  [17, "HeadlessChrome", row({ ua_raw: CHROME.replace("Chrome/", "HeadlessChrome/") }), expect({ kind: "unknown" })],
  [18, "agentic browser on the user's machine (blind spot)", row({}), expect({})],
  [19, "scraper faking a browser (blind spot)", row({}), expect({})],
  [20, "browser, Referer chatgpt.com", row({ referrer_agent: "ChatGPT", referral_signal: "referer" }),
    expect({ referral: { by: "ChatGPT", signal: "referer" } })],
  [21, "browser, utm_source=perplexity", row({ referrer_agent: "Perplexity", referral_signal: "utm" }),
    expect({ referral: { by: "Perplexity", signal: "utm" } })],
  [22, "browser, AI Assistant, Referer chatgpt.com", row({ ua_raw: CHROME, cf_bot_category: "AI Assistant", referrer_agent: "ChatGPT", referral_signal: "referer" }),
    expect({ kind: "ai-assistant", level: "attested", method: "cloudflare", name: "AI Assistant", referral: { by: "ChatGPT", signal: "referer" } })],
];

for (const [n, label, input, expected] of DECISION_TABLE) {
  test(`decision table row ${n}: ${label}`, () => {
    assert.deepEqual(deriveVisitor(input), expected);
  });
}

test("decision table has all 22 rows", () => {
  assert.deepEqual(DECISION_TABLE.map(([n]) => n), Array.from({ length: 22 }, (_, i) => i + 1));
});

test("row 4 variant: a valid signature is never 'contradicted', even without Cloudflare", () => {
  const r = deriveVisitor(row({ ua_match: "ChatGPT-User", ua_raw: CHATGPT_USER, sig_status: "valid", sig_agent: "chatgpt.com" }));
  assert.equal(r.level, "verified");
  assert.deepEqual(r.flags, []);
});

test("unverifiable signature from an allow-listed operator keeps its kind and product", () => {
  const r = deriveVisitor(row({ sig_status: "unverifiable", sig_agent: "chatgpt.com" }));
  assert.deepEqual(r, expect({ kind: "ai-assistant", level: "declared", method: "signature-agent", name: "ChatGPT agent", notes: ["sig-unchecked"] }));
});

test("demo key verified → ElevIQ demo agent", () => {
  const r = deriveVisitor(row({ sig_status: "valid", sig_agent: "eleviq.solutions" }));
  assert.deepEqual(r, expect({ kind: "ai-assistant", level: "verified", method: "web-bot-auth", name: "ElevIQ demo agent" }));
});

// CLS-10 — rows logged before this change (sig_status null).
function legacy(visitor: string, visitor_category: string, over: VisitorSignals = {}): VisitorSignals {
  return { visitor, visitor_category, cf_bot_category: null, referrer_agent: null, ...over };
}

test("legacy: GPTBot without Cloudflare → Declared + Claim not confirmed (AC-1)", () => {
  assert.deepEqual(deriveVisitor(legacy("GPTBot", "training")),
    expect({ kind: "ai-training", level: "declared", method: "user-agent", name: "GPTBot", flags: ["contradicted"] }));
});

test("legacy: ClaudeBot with AI Crawler → Attested", () => {
  assert.deepEqual(deriveVisitor(legacy("ClaudeBot", "training", { cf_bot_category: "AI Crawler" })),
    expect({ kind: "ai-training", level: "attested", method: "cloudflare", name: "ClaudeBot" }));
});

test("legacy: 'human' attested as AI Assistant leaves people (AC-1)", () => {
  assert.deepEqual(deriveVisitor(legacy("human", "human", { cf_bot_category: "AI Assistant" })),
    expect({ kind: "ai-assistant", level: "attested", method: "cloudflare", name: "AI Assistant" }));
});

test("legacy: human, unrecognized, no UA", () => {
  assert.deepEqual(deriveVisitor(legacy("human", "human")), expect({}));
  assert.deepEqual(deriveVisitor(legacy("unrecognized agent", "unrecognized")), expect({ kind: "unknown" }));
  assert.deepEqual(deriveVisitor(legacy("unrecognized (no User-Agent)", "unrecognized")), expect({ kind: "unknown" }));
});

test("legacy: referrer_agent → referral via Referer", () => {
  assert.deepEqual(deriveVisitor(legacy("human", "human", { referrer_agent: "ChatGPT" })),
    expect({ referral: { by: "ChatGPT", signal: "referer" } }));
});

test("legacy rows are never Verified and never signature-invalid", () => {
  const r = deriveVisitor(legacy("ChatGPT-User", "agent", { cf_bot_category: "AI Assistant" }));
  assert.equal(r.level, "attested");
  assert.deepEqual(r.flags, []);
});

test("legacy: facebookexternalhit is other-bot now, attested Page Preview stays other-bot", () => {
  assert.equal(deriveVisitor(legacy("facebookexternalhit", "search")).kind, "other-bot");
});

// JRN-3 — journey evidence.
test("journey: agent_claim only → Declared (journey-declared)", () => {
  assert.deepEqual(deriveVisitor(row({ agent_claim: "Claude" })),
    expect({ kind: "ai-assistant", level: "declared", method: "journey-declared", name: "Claude" }));
});

test("journey: MCP client name only → Declared (mcp-client)", () => {
  assert.deepEqual(deriveVisitor(row({ mcp_client: "claude-ai" })),
    expect({ kind: "ai-assistant", level: "declared", method: "mcp-client", name: "claude-ai" }));
});

test("journey: valid signature beats agent_claim", () => {
  const r = deriveVisitor(row({ sig_status: "valid", sig_agent: "chatgpt.com", agent_claim: "Claude" }));
  assert.equal(r.level, "verified");
  assert.equal(r.name, "ChatGPT agent");
});

test("internal flag", () => {
  assert.deepEqual(deriveVisitor(row({ internal: 1 })).flags, ["internal"]);
  assert.deepEqual(deriveVisitor(row({ ua_match: "GPTBot", ua_raw: GPTBOT, internal: 1 })).flags, ["contradicted", "internal"]);
});

test("signalKey: equal signals → equal key; any difference → different key", () => {
  const a = row({ ua_match: "GPTBot", ua_raw: GPTBOT });
  assert.equal(signalKey(a), signalKey({ ...a }));
  assert.notEqual(signalKey(a), signalKey({ ...a, cf_bot_category: "AI Crawler" }));
  assert.equal(signalKey({ ua_match: null }), signalKey({}));
});
