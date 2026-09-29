/**
 * Seeds the LOCAL journey database with varied, backdated journeys so the
 * dashboard can be developed before real traffic exists. Drives the real
 * engine (start, prepareStep, applyStep, cancel, expire), so every seeded
 * journey is one the protocol could actually have produced.
 *
 *   node scripts/seed-journeys.ts [count]      # default 180, over the last 28 days
 *
 * Local only by design: it runs `wrangler d1 execute --local` and has no
 * remote option. Seeded rows are marked agent_session "seed".
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyStep, cancel, expire, prepareStep, start } from "../journey/src/engine/engine.ts";
import { lintDefinition } from "../journey/src/engine/definitions.ts";
import { reconstructPrompt } from "../journey/src/engine/prompt.ts";
import type { Caller, JourneyDefinition, JourneyState } from "../journey/src/engine/types.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const DEF: JourneyDefinition = lintDefinition(JSON.parse(readFileSync(join(ROOT, "journey/definitions/lead-qualification.json"), "utf8")));
const COUNT = Number(process.argv[2] ?? 180);

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const maybe = <T>(p: number, v: T): T | undefined => (rnd() < p ? v : undefined);

const AGENTS: Array<{ caller: Caller; claim: string; weight: number; richness: number }> = [
  { caller: { keyid: null, agentName: null, trustTier: null }, claim: "ChatGPT", weight: 0.45, richness: 0.5 },
  { caller: { keyid: null, agentName: null, trustTier: null }, claim: "Perplexity", weight: 0.15, richness: 0.35 },
  { caller: { keyid: "seed-chatgpt-work", agentName: "ChatGPT", trustTier: "registry:https://chatgpt.com" }, claim: "ChatGPT Work", weight: 0.25, richness: 0.8 },
  { caller: { keyid: "seed-demo-agent", agentName: "ElevIQ Lab demo agent", trustTier: "own" }, claim: "ElevIQ reference client", weight: 0.15, richness: 0.95 },
];

const GOALS = [
  "Find a consultant to make our B2B shop usable by AI shopping agents",
  "Check whether our SaaS docs can be used by coding agents",
  "Compare providers that help publishers license content to AI companies",
  "Get a quote for an agent-readiness audit of our online store",
  "Understand how to let AI agents book appointments on our site",
];
const PROBLEMS = [
  "Our product catalogue and prices are not usable by AI shopping agents.",
  "Agents keep hallucinating our pricing because they cannot read it.",
  "We lose traffic to AI answers and do not know which agents visit us.",
  "Our booking flow breaks when an agent tries to use it.",
];

function pickAgent() {
  let r = rnd();
  for (const a of AGENTS) { if ((r -= a.weight) <= 0) return a; }
  return AGENTS[0];
}

function envelope(richness: number, claim: string) {
  const r = () => rnd() < richness;
  const e: Record<string, unknown> = {
    intent: pick(["qualify", "qualify", "compare", "discover", "transact"]),
    goal: pick(GOALS),
    human_present: rnd() < 0.7,
    agent_session: "seed",
  };
  if (r()) e.request_summary = pick([
    "find someone who can make our shop work with ChatGPT agents, ideally local",
    "get a price for making our site readable by AI assistants before year end",
    "shortlist two or three agencies that do agent readiness, budget around 5k",
  ]);
  if (r()) e.principal = {
    type: pick(["business", "business", "business", "consumer"]),
    ...(r() ? { role: pick(["head of e-commerce", "CTO", "marketing lead", "founder"]) } : {}),
    ...(r() ? { organization_size: pick(["2-9", "10-49", "50-249", "250-999"]) } : {}),
    ...(r() ? { industry: pick(["industrial supplies", "fashion retail", "software", "publishing", "healthcare"]) } : {}),
    ...(r() ? { region: pick(["CH", "CH", "DE", "AT", "FR"]) } : {}),
  };
  if (r()) e.journey_stage = pick(["researching", "shortlisting", "shortlisting", "deciding"]);
  if (r()) e.constraints = [
    { field: "price", op: "lte", value: pick([3000, 5000, 8000, 15000]), unit: "EUR" },
    ...(rnd() < 0.5 ? [{ field: "deadline", op: "lte", value: "2026-12-15" }] : []),
    ...(rnd() < 0.3 ? [{ field: "language", op: "in", value: ["de", "en"] }] : []),
    ...(rnd() < 0.2 ? [{ note: "no platform migration" }] : []),
  ];
  if (r()) e.decision_criteria = [
    { criterion: pick(["price", "price", "speed"]), direction: "minimize" },
    ...(rnd() < 0.6 ? [{ criterion: pick(["proven experience", "local presence", "references"]) }] : []),
  ];
  if (r()) e.alternatives_considered = [pick(["competitor-a.example", "agency-b.example", "in-house"]), ...(rnd() < 0.4 ? ["freelancer"] : [])];
  if (r()) e.authority = { can_commit: rnd() < 0.2 };
  if (r()) e.discovery_source = pick(["web-search", "web-search", "model-knowledge", "link"]);
  if (r()) e.agent_claim = { product: claim };
  return e;
}

const qualify = () => ({
  customer_type: pick(["b2b-shop", "b2b-shop", "b2c-shop", "saas", "publisher", "services"]),
  problem: pick(PROBLEMS),
  budget_eur: pick([500, 1500, 2500, 4000, 5000, 6000, 9000, 12000, 25000]),
  deadline: pick(["2026-10-31", "2026-11-30", "2026-12-15", "2027-01-31", "2027-03-31"]),
  ...(rnd() < 0.5 ? { services_of_interest: [pick(["site-analysis", "readiness-scorecard", "gateway"])] } : {}),
});

type Ev = { ts: string; step: string; outcome: string; reason: string | null; status: number; details: string | null };
const q = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

async function ref(id: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const sql: string[] = ["DELETE FROM journey_events WHERE journey_id IN (SELECT id FROM journeys WHERE json_extract(intent, '$.agent_session') = 'seed');",
  "DELETE FROM journeys WHERE json_extract(intent, '$.agent_session') = 'seed';"];
const now = Date.now();

for (let i = 0; i < COUNT; i++) {
  const agent = pickAgent();
  const id = `jrn_seed${String(i).padStart(4, "0")}${"a".repeat(18)}`;
  let t = new Date(now - rnd() * 28 * 86_400_000);
  const tick = () => (t = new Date(t.getTime() + (5 + rnd() * 60) * 1000));
  const events: Ev[] = [];
  const ev = (step: string, outcome: string, status: number, reason: string | null = null, details: unknown = null) =>
    events.push({ ts: t.toISOString(), step, outcome, reason, status, details: details ? JSON.stringify(details) : null });

  const s0 = start(DEF, { intent: envelope(agent.richness, agent.claim) }, agent.caller, id, t);
  if (!s0.ok) { ev("start", "rejected", s0.status, s0.reason); continue; }
  let s: JourneyState = s0.state;
  ev("start", "accepted", 201);

  const doStep = (name: string, fields: object, body: Record<string, unknown> = {}) => {
    tick();
    const plan = prepareStep(DEF, s, name, { fields, ...body }, agent.caller, t);
    if (!plan.ok) { ev(name, "rejected", plan.status, plan.reason, plan.problems ? { fields: plan.problems.map((p) => `${p.field}:${p.problem}`) } : null); return false; }
    const out = applyStep(DEF, s, plan, t);
    s = out.state;
    ev(name, "accepted", 200, out.ended?.reason ?? null);
    return true;
  };

  // Realistic mistakes: skipping ahead, sending too little.
  if (rnd() < 0.12) doStep("qualify", qualify());
  if (rnd() < 0.85) doStep("discover", {});
  const leave = rnd();
  if (s.completedSteps.includes("discover") && leave > 0.15) {
    if (rnd() < 0.25) doStep("qualify", { customer_type: "b2b-shop" });
    doStep("qualify", qualify());
  }
  if (s.status === "active" && s.completedSteps.includes("qualify") && leave > 0.35) {
    tick();
    ev("verification-code", "accepted", 200);
    if (rnd() < 0.15) { tick(); ev("verify", "rejected", 403, "user-binding-failed"); }
    doStep("verify", { acting_for: "x@example.com", code: "123456" }, { human_present: true });
  }
  if (s.status === "active" && s.completedSteps.includes("verify") && leave > 0.45) {
    doStep("transact", { requested_action: pick(["book-call", "book-call", "request-quote"]) });
  }
  if (s.status === "active" && rnd() < 0.35) {
    tick();
    const c = cancel(s, pick([
      { reason: "price-too-high" },
      { reason: "found-alternative", alternative_chosen: pick(["competitor-a.example", "agency-b.example", "in-house"]) },
      { reason: "constraint-unmet", detail: "Could not start before the user's deadline" },
      { reason: "user-declined" },
    ]), agent.caller, t);
    if (c.ok) { s = c.state; ev("cancel", "accepted", 200, s.endReason); }
  }
  if (s.status === "active") {
    const later = new Date(Date.parse(s.expiresAt) + 1000);
    if (later.getTime() < now) s = expire(s, later);
  }

  sql.push(`INSERT INTO journeys (id, ref, definition_id, definition_version, status, end_reason, end_detail, alternative_chosen, keyid, agent_name, trust_tier, intent, intent_kind, human_present, completeness, completed_steps, step_data, reconstructed_prompt, transport, traceparent, revision, created_at, updated_at, expires_at, ended_at) VALUES (${[
    s.id, await ref(s.id), s.definitionId, s.definitionVersion, s.status, s.endReason, s.endDetail, s.alternativeChosen, s.keyid, s.agentName, s.trustTier,
    JSON.stringify(s.intent), String(s.intent.intent), s.intent.human_present ? 1 : 0, s.completeness, JSON.stringify(s.completedSteps),
    JSON.stringify(s.stepData), reconstructPrompt(s.intent, s.stepData), "http", null, s.revision, s.createdAt, s.updatedAt, s.expiresAt, s.endedAt,
  ].map(q).join(", ")});`);
  for (const e of events) {
    sql.push(`INSERT INTO journey_events (journey_id, definition_id, ts, step, outcome, reason, status, details, keyid, transport) VALUES (${[
      s.id, DEF.id, e.ts, e.step, e.outcome, e.reason, e.status, e.details, agent.caller.keyid, "http",
    ].map(q).join(", ")});`);
  }
}

const file = join(mkdtempSync(join(tmpdir(), "journey-seed-")), "seed.sql");
writeFileSync(file, sql.join("\n"));
execFileSync("npx", ["wrangler", "d1", "execute", "eleviq-lab-journeys", "--config", "journey/wrangler.toml", "--local", `--file=${file}`], { cwd: ROOT, stdio: "inherit" });
console.log(`seeded ${COUNT} journeys into the LOCAL database`);
