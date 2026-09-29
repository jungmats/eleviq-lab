/**
 * ElevIQ Lab — Agent Journey reference client.
 *
 * Walks a journey the way an agent would: discover, declare intent, follow
 * next_steps, recover from refusals. Signs every call with Web Bot Auth
 * unless --unsigned is given.
 *
 * Setup (see https://lab.eleviq.solutions/journey/):
 *   mkdir aj && cd aj
 *   npm init -y && npm install web-bot-auth
 *   curl -O https://lab.eleviq.solutions/reference/journey-run.mjs
 *   curl -O https://lab.eleviq.solutions/reference/demo-agent.jwk.json
 *   curl -O https://lab.eleviq.solutions/reference/demo-agent-b.jwk.json   # only for --scenario wrong-agent
 *
 * Use:
 *   node journey-run.mjs --base <journey Worker URL> [--scenario <name>|all] [--unsigned] [--key <jwk>]
 *
 * Scenarios: happy, skip, missing, below-budget, wrong-agent, cancel, expired, unsigned, all
 * Exit code is non-zero if any scenario does not end the way it should.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sign, generateNonce } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const BASE = String(arg("base", "http://localhost:8788")).replace(/\/+$/, "");
const SCENARIO = String(arg("scenario", "happy"));
const UNSIGNED = arg("unsigned", false) === true;
const keyFile = (name) => {
  const p = [name, join(HERE, name)].find((f) => existsSync(f));
  if (!p) throw new Error(`key file ${name} not found`);
  return JSON.parse(readFileSync(p, "utf8"));
};
const KEY_A = UNSIGNED ? null : keyFile(String(arg("key", "demo-agent.jwk.json")));

/* ------------------------------------------------------------ transport */

async function signed(url, jwk) {
  if (!jwk) return {};
  const signatureAgent = `sig1="${new URL(url).origin}";type=directory`;
  const now = new Date();
  const f = await sign(new Request(url, { headers: { "Signature-Agent": signatureAgent } }), {
    signer: await signerFromJWK(jwk),
    created: now,
    expires: new Date(now.getTime() + 5 * 60_000),
    nonce: generateNonce(),
    target: "@target-uri",
    label: "sig1",
  });
  return { "Signature-Input": f.signatureInput, Signature: f.signature, "Signature-Agent": signatureAgent };
}

async function call(method, url, body, jwk = KEY_A) {
  const headers = { Accept: "application/json", ...(await signed(url, jwk)) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const path = new URL(url).pathname.replace(/jrn_[a-z2-7]+/, "{id}");
  const tag = res.ok ? "✓" : "✗";
  console.log(`  ${tag} ${method} ${path} → ${res.status}${data.reason ? ` ${data.reason}` : ""}${data.status && typeof data.status === "string" ? ` [${data.status}]` : ""}`);
  return { status: res.status, data };
}

/* ------------------------------------------------------------- journeys */

const INTENT = {
  intent: "qualify",
  goal: "Find a consultant to make our B2B shop usable by AI shopping agents",
  human_present: true,
  request_summary: "Find someone in Switzerland who can make our shop work with ChatGPT agents, under 5k, before end of November",
  agent_session: "reference-client",
  principal: { type: "business", role: "head of e-commerce", industry: "industrial supplies", organization_size: "50-249", locale: "de-CH", region: "CH" },
  journey_stage: "shortlisting",
  constraints: [
    { field: "price", op: "lte", value: 5000, unit: "EUR" },
    { field: "deadline", op: "lte", value: "2026-11-30" },
    { note: "must not require a platform migration" },
  ],
  decision_criteria: [
    { criterion: "price", direction: "minimize", weight: 0.4 },
    { criterion: "proven agent-readiness experience", weight: 0.4 },
    { criterion: "local presence", weight: 0.2 },
  ],
  alternatives_considered: ["competitor-a.example", "in-house"],
  authority: { can_commit: false, needs_approval_from: "user" },
  expected_deliverable: "a shortlist with a recommendation",
  discovery_source: "web-search",
  agent_claim: { product: "ElevIQ reference client", platform: "node" },
};

const QUALIFY = {
  customer_type: "b2b-shop",
  problem: "Our product catalogue and prices are not usable by AI shopping agents.",
  budget_eur: 5000,
  deadline: "2026-11-30",
  services_of_interest: ["site-analysis", "readiness-scorecard"],
};

async function startJourney(definition = "lead-qualification", jwk = KEY_A) {
  const r = await call("POST", `${BASE}/api/journey/start`, { definition, intent: INTENT }, jwk);
  if (r.status !== 201) throw new Error(`start failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

const stepUrl = (j, step) => `${BASE}/api/journey/${j.journey_id}/steps/${step}`;

async function verify(j) {
  const email = "jane@example.com";
  const code = await call("POST", `${BASE}/api/journey/${j.journey_id}/verification-code`, { acting_for: email });
  return call("POST", stepUrl(j, "verify"), { fields: { acting_for: email, code: code.data.code } });
}

const SCENARIOS = {
  async happy() {
    const j = await startJourney();
    await call("POST", stepUrl(j, "discover"), {});
    await call("POST", stepUrl(j, "qualify"), { fields: QUALIFY });
    await verify(j);
    const t = await call("POST", stepUrl(j, "transact"), { fields: { requested_action: "book-call", preferred_slot: "mornings next week" } });
    return t.data.status === "achieved";
  },
  async skip() {
    const j = await startJourney();
    await call("POST", stepUrl(j, "discover"), {});
    const r = await call("POST", stepUrl(j, "verify"), { fields: { acting_for: "jane@example.com", code: "123456" } });
    return r.status === 409 && r.data.reason === "step-out-of-order" && r.data.next_steps?.[0]?.step === "qualify";
  },
  async missing() {
    const j = await startJourney();
    await call("POST", stepUrl(j, "discover"), {});
    const bad = await call("POST", stepUrl(j, "qualify"), { fields: { customer_type: "b2b-shop" } });
    const good = await call("POST", stepUrl(j, "qualify"), { fields: QUALIFY });
    return bad.status === 422 && bad.data.problems?.length === 3 && good.status === 200;
  },
  async "below-budget"() {
    const j = await startJourney();
    await call("POST", stepUrl(j, "discover"), {});
    const q = await call("POST", stepUrl(j, "qualify"), { fields: { ...QUALIFY, budget_eur: 800 } });
    const after = await call("POST", stepUrl(j, "transact"), { fields: { requested_action: "book-call" } });
    return q.data.status === "not_achieved" && after.data.reason === "journey-closed";
  },
  async "wrong-agent"() {
    if (!KEY_A) return true;
    const j = await startJourney();
    const r = await call("POST", stepUrl(j, "discover"), {}, keyFile("demo-agent-b.jwk.json"));
    const own = await call("POST", stepUrl(j, "discover"), {});
    return r.status === 403 && r.data.reason === "wrong-agent" && !r.data.next_steps && own.status === 200;
  },
  async cancel() {
    const j = await startJourney();
    await call("POST", stepUrl(j, "discover"), {});
    const c = await call("POST", `${BASE}/api/journey/${j.journey_id}/cancel`, {
      reason: "found-alternative", detail: "A local agency could start earlier", alternative_chosen: "competitor-a.example",
    });
    return c.data.status === "cancelled";
  },
  async expired() {
    const j = await startJourney("demo-expiring");
    await call("POST", `${BASE}/api/journey/${j.journey_id}/steps/discover`, {});
    console.log("  … idling 6 s");
    await new Promise((r) => setTimeout(r, 6000));
    const r = await call("POST", `${BASE}/api/journey/${j.journey_id}/steps/finish`, {});
    return r.status === 410 && r.data.reason === "journey-expired";
  },
  async unsigned() {
    const j = await startJourney("lead-qualification", null);
    const r = await call("POST", stepUrl(j, "discover"), {}, null);
    return j.verified_agent === null && r.status === 200;
  },
};

const names = SCENARIO === "all" ? Object.keys(SCENARIOS) : [SCENARIO];
let failed = 0;
for (const name of names) {
  if (!SCENARIOS[name]) { console.error(`unknown scenario ${name}`); process.exit(2); }
  console.log(`\n${name}`);
  let ok = false;
  try { ok = await SCENARIOS[name](); } catch (e) { console.log(`  ! ${e.message}`); }
  console.log(`  ${ok ? "PASS" : "FAIL"}`);
  if (!ok) failed++;
}
console.log(`\n${names.length - failed}/${names.length} scenarios behaved as expected`);
process.exit(failed ? 1 : 0);
