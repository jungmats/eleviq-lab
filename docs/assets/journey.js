/* ElevIQ Lab — Journey console.
 *
 * Plays the agent against the journey Worker: each scenario is a scripted
 * sequence of real calls (same scripts as reference/journey-run.mjs). Signs
 * with the demo key like the other consoles; "wrong agent" uses the second
 * trusted demo key; "unsigned" sends no signature at all.
 */
import { sign, generateNonce, signerFromJWK } from "./agent-sign.js";

const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const BASE = (
  LOCAL
    ? "http://localhost:8788"
    : document.querySelector('meta[name="journey-gateway"]')?.content || "https://eleviq-lab-journey.gateway-worker.workers.dev"
).replace(/\/+$/, "");

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

if (LOCAL) {
  $("dashboard-link").href = `${BASE}/dashboard/`;
  for (const id of ["curl-discover", "curl-start"]) $(id).textContent = $(id).textContent.replaceAll("https://eleviq-lab-journey.gateway-worker.workers.dev", BASE);
}

/* ---------------------------------------------------------------- keys */

const keys = {};
async function key(name) {
  if (!keys[name]) {
    const res = await fetch(`/reference/${name}.jwk.json`);
    if (!res.ok) throw new Error(`could not load ${name} key (${res.status})`);
    keys[name] = await res.json();
  }
  return keys[name];
}

async function signedHeaders(url, keyName) {
  if (!keyName) return {};
  const signatureAgent = `sig1="${new URL(url).origin}";type=directory`;
  const now = new Date();
  const f = await sign(new Request(url, { headers: { "Signature-Agent": signatureAgent } }), {
    signer: await signerFromJWK(await key(keyName)),
    created: now,
    expires: new Date(now.getTime() + 5 * 60_000),
    nonce: generateNonce(),
    target: "@target-uri",
    label: "sig1",
  });
  return { "Signature-Input": f.signatureInput, Signature: f.signature, "Signature-Agent": signatureAgent };
}

/* ------------------------------------------------------------- recorder */

let calls = [];
let definitionSteps = [];

async function call(method, path, body, keyName = "demo-agent", label = null) {
  const url = BASE + path;
  const headers = { Accept: "application/json", ...(await signedHeaders(url, keyName)) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const entry = { method, path, body, keyName, status: res.status, statusText: res.statusText, data, label };
  calls.push(entry);
  renderCalls(calls.length - 1);
  if (data.completed_steps || data.journey_status) renderChips(data);
  return entry;
}

const shortPath = (p) => p.replace(/jrn_[a-z2-7]+/, "{id}");

function renderCalls(selected) {
  $("calls").innerHTML = calls.map((c, i) => {
    const ok = c.status < 400;
    return `<li><button type="button" data-i="${i}" class="${i === selected ? "is-selected" : ""}">
      <span class="${ok ? "v-ok" : "v-bad"}">${ok ? "✓" : "✗"} ${c.status}</span>
      <span class="call-path">${esc(c.method)} ${esc(shortPath(c.path))}</span>
      ${c.data.reason ? `<span class="call-reason">${esc(c.data.reason)}</span>` : ""}
      ${c.label ? `<span class="call-note">${esc(c.label)}</span>` : ""}
    </button></li>`;
  }).join("");
  showCall(selected);
}

function showCall(i) {
  const c = calls[i];
  if (!c) return;
  for (const b of $("calls").querySelectorAll("button")) b.classList.toggle("is-selected", Number(b.dataset.i) === i);
  const who = c.keyName ? `signed with ${c.keyName}` : "unsigned";
  $("body-title").textContent = `Call ${i + 1}: ${c.method} ${shortPath(c.path)} (${who})`;
  $("call-body").textContent =
    (c.body !== undefined ? `→ request body\n${JSON.stringify(c.body, null, 2)}\n\n` : "") +
    `← HTTP ${c.status} ${c.statusText}\n${JSON.stringify(c.data, null, 2)}`;
}

$("calls").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (b) showCall(Number(b.dataset.i));
});

function renderChips(view) {
  const done = view.completed_steps ?? [];
  const next = (view.next_steps ?? []).map((n) => n.step);
  $("chips").innerHTML = definitionSteps.map((s) => {
    const cls = done.includes(s) ? "is-done" : next.includes(s) ? "is-next" : "";
    const mark = done.includes(s) ? "✓" : next.includes(s) ? "→" : "·";
    return `<li class="${cls}">${mark} ${esc(s)}</li>`;
  }).join("");
}

function setVerdict(kind, status, reason, facts = []) {
  const v = $("verdict");
  v.className = "verdict " + ({ ok: "is-ok", bad: "is-bad", warn: "is-warn" }[kind] || "");
  v.querySelector(".status").textContent = status;
  v.querySelector(".reason").textContent = reason;
  $("facts").innerHTML = facts.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join("");
  $("facts").hidden = !facts.length;
}

/* ------------------------------------------------------------- journeys */

const INTENT = {
  intent: "qualify",
  goal: "Find a consultant to make our B2B shop usable by AI shopping agents",
  human_present: true,
  request_summary: "find someone in Switzerland who can make our shop work with ChatGPT agents, under 5k, before end of November",
  agent_session: "lab-console",
  principal: { type: "business", role: "head of e-commerce", organization_size: "50-249", industry: "industrial supplies", region: "CH" },
  journey_stage: "shortlisting",
  constraints: [{ field: "price", op: "lte", value: 5000, unit: "EUR" }, { field: "deadline", op: "lte", value: "2026-11-30" }],
  decision_criteria: [{ criterion: "price", direction: "minimize" }, { criterion: "local presence" }],
  alternatives_considered: ["competitor-a.example"],
  authority: { can_commit: false },
  discovery_source: "web-search",
  agent_claim: { product: "ElevIQ lab console" },
};
const QUALIFY = {
  customer_type: "b2b-shop",
  problem: "Our product catalogue and prices are not usable by AI shopping agents.",
  budget_eur: 5000,
  deadline: "2026-11-30",
};

async function start(definition = "lead-qualification", keyName = "demo-agent") {
  const r = await call("POST", "/api/journey/start", { definition, intent: INTENT }, keyName, "intent handshake");
  if (r.status !== 201) throw new Error(r.data.detail || "start failed");
  return r.data.journey_id;
}
const step = (id, name, fields = {}, keyName = "demo-agent", label = null, extra = {}) =>
  call("POST", `/api/journey/${id}/steps/${name}`, { fields, ...extra }, keyName, label);

const SCENARIOS = {
  async happy() {
    const id = await start();
    await step(id, "discover");
    await step(id, "qualify", QUALIFY);
    const code = await call("POST", `/api/journey/${id}/verification-code`, { acting_for: "jane@example.com" }, "demo-agent", "code goes to the user (demo: returned)");
    await step(id, "verify", { acting_for: "jane@example.com", code: code.data.code }, "demo-agent", "the user gave the agent the code");
    return step(id, "transact", { requested_action: "book-call" });
  },
  async skip() {
    const id = await start();
    await step(id, "discover");
    return step(id, "verify", { acting_for: "jane@example.com", code: "123456" }, "demo-agent", "skips qualify");
  },
  async missing() {
    const id = await start();
    await step(id, "discover");
    await step(id, "qualify", { customer_type: "b2b-shop" }, "demo-agent", "sends one field");
    return step(id, "qualify", QUALIFY, "demo-agent", "reads the refusal, sends the rest");
  },
  async "below-budget"() {
    const id = await start();
    await step(id, "discover");
    const q = await step(id, "qualify", { ...QUALIFY, budget_eur: 800 }, "demo-agent", "budget 800 EUR");
    await step(id, "transact", { requested_action: "book-call" }, "demo-agent", "tries to continue anyway");
    return q;
  },
  async cancel() {
    const id = await start();
    await step(id, "discover");
    return call("POST", `/api/journey/${id}/cancel`, { reason: "found-alternative", detail: "A local agency could start earlier", alternative_chosen: "competitor-a.example" }, "demo-agent", "user chose someone else");
  },
  async "wrong-agent"() {
    const id = await start();
    const r = await step(id, "discover", {}, "demo-agent-b", "agent B, not the one that started it");
    await step(id, "discover", {}, "demo-agent", "the original agent continues fine");
    return r;
  },
  async expired() {
    const id = await start("demo-expiring");
    await call("POST", `/api/journey/${id}/steps/discover`, {}, "demo-agent");
    setVerdict("warn", "… idling", "Waiting 6 seconds; this demo journey times out after 5.");
    await new Promise((r) => setTimeout(r, 6000));
    return call("POST", `/api/journey/${id}/steps/finish`, {}, "demo-agent", "after 6 s idle");
  },
  async unsigned() {
    const id = await start("lead-qualification", null);
    await step(id, "discover", {}, null);
    return step(id, "qualify", QUALIFY, null);
  },
};

function verdictFor(name, last) {
  const d = last.data;
  const facts = [];
  if (d.status && typeof d.status === "string") facts.push(["Journey status", d.status]);
  if (d.a2a_state) facts.push(["A2A task state", d.a2a_state]);
  if (d.end_reason) facts.push(["End reason", d.end_reason]);
  if (d.reason) facts.push(["Refusal", d.reason]);
  if (d.verified_agent !== undefined) facts.push(["Agent", d.verified_agent ? d.verified_agent.name : "unverified"]);

  if (d.status === "achieved") return ["ok", "✅  ACHIEVED", "The journey reached its final step. Every step came in order, with the information it asked for.", facts];
  if (d.status === "not_achieved") return ["warn", "⚠️  NOT ACHIEVED", d.message || "A business rule ended the journey.", facts];
  if (d.status === "cancelled") return ["warn", "⚠️  CANCELLED", "The agent ended the journey and said why: the most useful signal a site can get.", facts];
  if (d.reason === "wrong-agent") return ["bad", "⛔  REFUSED · 403", "The journey is bound to the key that started it. Agent B gets nothing, not even the next steps.", facts];
  if (d.reason === "journey-expired") return ["bad", "⛔  EXPIRED · 410", "Idle past its timeout. The dashboard counts it as abandoned.", facts];
  if (d.reason === "step-out-of-order") return ["bad", "⛔  REFUSED · 409", `The refusal names what is missing (${(d.missing_steps || []).join(", ")}) and links the next step. The journey stays open.`, facts];
  if (name === "missing") return ["ok", "✅  RECOVERED", "The first attempt was refused with every missing field listed; the second went through. The journey never broke.", facts];
  if (name === "unsigned") return ["warn", "⚠️  ACCEPTED, UNVERIFIED", "Unsigned agents can run this journey, bound only by the journey id. The dashboard shows them apart.", facts];
  return [last.status < 400 ? "ok" : "bad", `HTTP ${last.status}`, d.detail || "", facts];
}

async function run() {
  const name = document.querySelector('input[name="scenario"]:checked').value;
  const btn = $("run");
  btn.disabled = true;
  calls = [];
  $("calls").innerHTML = "";
  $("call-body").textContent = "—";
  setVerdict("", "… running", "");
  try {
    const def = await (await fetch(`${BASE}/journeys/${name === "expired" ? "demo-expiring" : "lead-qualification"}`)).json();
    definitionSteps = Object.keys(def.steps);
    renderChips({ completed_steps: [], next_steps: [] });
    const last = await SCENARIOS[name]();
    const [kind, status, reason, facts] = verdictFor(name, last);
    setVerdict(kind, status, reason, facts);
    showCall(calls.indexOf(last));
  } catch (err) {
    setVerdict("bad", "— Error", String(err?.message ?? err));
  } finally {
    btn.disabled = false;
  }
}

$("run").addEventListener("click", run);

const params = new URLSearchParams(location.search);
if (params.has("scenario")) {
  const input = document.querySelector(`input[name="scenario"][value="${CSS.escape(params.get("scenario"))}"]`);
  if (input) { input.checked = true; run(); }
}
