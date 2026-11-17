import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateMonthly, aggregateWindow, classifier, parseFilters, passes, periodNote, type Filters, type Tuple } from "../src/lib/visits.ts";

const ALL: Filters = parseFilters(new URLSearchParams()).ok
  ? (parseFilters(new URLSearchParams()) as { ok: true; filters: Filters }).filters
  : (null as never);
const with_ = (q: string): Filters => {
  const r = parseFilters(new URLSearchParams(q));
  if (!r.ok) throw new Error(r.error);
  return r.filters;
};

const GPTBOT_UA = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";

// Legacy rows (sig_status null): classified from the legacy columns (CLS-10).
const legacyGptbotUnattested: Tuple = { visitor: "GPTBot", visitor_category: "training", cf_bot_category: null, sig_status: null, n: 5, period: "2026-11-01", path: "/" };
const legacyHumanAttested: Tuple = { visitor: "human", visitor_category: "human", cf_bot_category: "AI Assistant", sig_status: null, n: 3, period: "2026-11-01", path: "/" };
const legacyHuman: Tuple = { visitor: "human", visitor_category: "human", sig_status: null, n: 50, period: "2026-11-02", path: "/" };
// New rows.
const human: Tuple = { sig_status: "none", ua_raw: null, internal: 0, n: 20, period: "2026-11-17", path: "/fr/" };
const humanReferredUtm: Tuple = { ...human, referrer_agent: "ChatGPT", referral_signal: "utm", n: 2 };
const humanReferredRef: Tuple = { ...human, referrer_agent: "ChatGPT", referral_signal: "referer", n: 4 };
const gptbotAttested: Tuple = { ua_match: "GPTBot", ua_raw: GPTBOT_UA, cf_bot_category: "AI Crawler", sig_status: "none", internal: 0, n: 7, period: "2026-11-17", path: "/fr/" };
const demoVerified: Tuple = { ua_raw: "ElevIQ-Smoke/1.0", sig_status: "valid", sig_agent: "eleviq.solutions", internal: 0, n: 1, period: "2026-11-17", path: "/" };
const tampered: Tuple = { ua_raw: "ElevIQ-Smoke/1.0", sig_status: "invalid", sig_agent: "eleviq.solutions", internal: 0, n: 1, period: "2026-11-17", path: "/" };

const TUPLES = [legacyGptbotUnattested, legacyHumanAttested, legacyHuman, human, humanReferredUtm, humanReferredRef, gptbotAttested, demoVerified, tampered];

test("AC-1 shape: legacy unattested GPTBot is Declared + Claim not confirmed; legacy human attested by Cloudflare is not people", () => {
  const c = classifier();
  const g = c(legacyGptbotUnattested);
  assert.equal(g.level, "declared");
  assert.ok(g.flags.includes("contradicted"));
  const h = c(legacyHumanAttested);
  assert.equal(h.kind, "ai-assistant");
  assert.equal(h.level, "attested");
});

test("summary counts every tuple once, by kind and by level, with flag counts", () => {
  const a = aggregateWindow(TUPLES, ALL);
  const total = TUPLES.reduce((s, t) => s + t.n, 0);
  assert.equal(a.summary.total, total);
  assert.equal(Object.values(a.summary.by_kind).reduce((s, n) => s + n, 0), total);
  assert.equal(Object.values(a.summary.by_level).reduce((s, n) => s + n, 0), total);
  assert.equal(a.summary.flags.contradicted, 5);
  assert.equal(a.summary.flags["signature-invalid"], 1);
  assert.equal(a.summary.by_level.verified, 1);
});

test("Hide people removes people from every block and rescales page shares", () => {
  const a = aggregateWindow(TUPLES, with_("hide_people=1"));
  assert.equal(a.summary.by_kind.people, 0);
  assert.ok(a.daily.every((d) => d.key !== "people"));
  for (const p of a.top_pages) {
    assert.equal(p.n, p.ai_n);
    assert.equal(p.share, 1);
  }
  assert.deepEqual(a.referrals, [], "referrals are people, so none remain");
  const m = aggregateMonthly(TUPLES, with_("hide_people=1"));
  assert.ok(m.monthly.every((r) => r.key !== "people"));
});

test("page share = AI/bot visits over all visits shown", () => {
  const a = aggregateWindow(TUPLES, ALL);
  const fr = a.top_pages.find((p) => p.path === "/fr/")!;
  assert.equal(fr.n, 20 + 2 + 4 + 7);
  assert.equal(fr.ai_n, 7);
});

test("minimum evidence: verified keeps only verified; attested keeps verified + attested", () => {
  const v = aggregateWindow(TUPLES, with_("min=verified"));
  assert.equal(v.summary.total, 1);
  const at = aggregateWindow(TUPLES, with_("min=attested"));
  assert.equal(at.summary.total, 1 + 3 + 7);
  assert.equal(at.summary.by_kind.people, 0, "people carry no evidence level");
});

test("kind filter intersects", () => {
  const a = aggregateWindow(TUPLES, with_("kinds=ai-training"));
  assert.deepEqual(
    Object.entries(a.summary.by_kind).filter(([, n]) => n > 0).map(([k]) => k),
    ["ai-training"],
  );
});

test("flagged filter affects entries only, not aggregates", () => {
  const f = with_("flagged=contradicted");
  assert.equal(aggregateWindow(TUPLES, f).summary.total, aggregateWindow(TUPLES, ALL).summary.total);
  const c = classifier();
  assert.equal(passes(c(legacyGptbotUnattested), f, true), true);
  assert.equal(passes(c(gptbotAttested), f, true), false);
  assert.equal(passes(c(gptbotAttested), f, false), true);
});

test("agents breakdown: per name, levels and flags sum to the total", () => {
  const a = aggregateWindow(TUPLES, ALL);
  const gpt = a.agents.find((x) => x.name === "GPTBot")!;
  assert.equal(gpt.total, 12);
  assert.equal(gpt.levels.declared, 5);
  assert.equal(gpt.levels.attested, 7);
  assert.equal(gpt.flags.contradicted, 5);
  for (const ag of a.agents) {
    assert.equal(Object.values(ag.levels).reduce((s, n) => s + n, 0), ag.total, ag.name);
    assert.ok(!ag.kinds.includes("people"));
  }
});

test("one agent row per name, listing every kind the evidence gave it", () => {
  const cfSearch: Tuple = { ua_match: "Bytespider", ua_raw: "Mozilla/5.0 (compatible; Bytespider)", cf_bot_category: "Search Engine Crawler", sig_status: "none", internal: 0, n: 16, period: "2026-11-17", path: "/" };
  const uaOnly: Tuple = { ...cfSearch, cf_bot_category: null, n: 14 };
  const a = aggregateWindow([cfSearch, uaOnly], ALL);
  const rows = a.agents.filter((x) => x.name === "Bytespider");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 30);
  assert.equal(rows[0].kinds[0], "search", "most visits first");
  assert.equal(rows[0].kinds.length, 2);
});

test("referrals: people referred per assistant, split by signal", () => {
  const a = aggregateWindow(TUPLES, ALL);
  assert.deepEqual(a.referrals, [{ by: "ChatGPT", referer: 4, utm: 2, total: 6 }]);
});

test("monthly by level counts non-people only (DSH-8)", () => {
  const m = aggregateMonthly(TUPLES.map((t) => ({ ...t, period: t.period!.slice(0, 7) })), ALL);
  const sum = m.monthly_levels.reduce((s, r) => s + r.n, 0);
  assert.equal(sum, 5 + 3 + 7 + 1 + 1);
  assert.ok(m.monthly_levels.some((r) => r.key === "verified" && r.n === 1));
});

test("internal rows carry the internal flag (excluded in SQL unless SHOW_INTERNAL)", () => {
  const c = classifier();
  assert.ok(c({ ...human, internal: 1 }).flags.includes("internal"));
});

test("period note: reaches before when the shown data starts earlier", () => {
  assert.deepEqual(periodNote("2026-11-17T13:44:05.000Z", "2026-09-11"), { date: "2026-11-17", reaches_before: true });
  assert.deepEqual(periodNote("2026-11-17T13:44:05.000Z", "2026-11-18"), { date: "2026-11-17", reaches_before: false });
  assert.deepEqual(periodNote(null, "2026-09-11"), { date: null, reaches_before: true });
});

test("invalid parameters are rejected with the allowed values", () => {
  for (const q of ["min=high", "kinds=people,robots", "flagged=internal", "hide_people=yes", "lang=de", "limit=7", "limit=all"]) {
    const r = parseFilters(new URLSearchParams(q));
    assert.equal(r.ok, false, q);
  }
  assert.deepEqual(with_("kinds=search,people").kinds, ["people", "search"], "kept in canonical order");
  assert.equal(ALL.limit, 10, "10 events by default");
  assert.equal(with_("limit=500").limit, 500);
});
