/* ElevIQ Lab — Demo 3 (Delegate) console.
 *
 * Identity is fixed here too — every request signs with the same trusted
 * "ElevIQ Lab demo agent" key as Demo 1/2. What's new is a second, separate
 * proof: a one-time code tied to the email the agent claims to act for.
 *
 * SIMULATED: requesting a code returns it directly in the response instead
 * of emailing it — clearly labeled wherever it's shown. See PLAN.md / the
 * page's own §1 for why, and what a real deployment would do instead.
 */
import { sign, generateNonce, signerFromJWK } from "./agent-sign.js";

const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const GATEWAY = (
  LOCAL
    ? "http://localhost:8787"
    : document.querySelector('meta[name="gateway"]')?.content ||
      "https://eleviq-lab-gateway.gateway-worker.workers.dev"
).replace(/\/+$/, "");
const CODE_PATH = "/api/delegate/request-code";
const ACCOUNT_PATH = "/api/delegate/account";

const $ = (id) => document.getElementById(id);
const scenarioOf = () => document.querySelector('input[name="scenario"]:checked').value;
const emailOf = () => $("acting-for").value.trim();

let demoKey = null;
async function loadKey() {
  if (!demoKey) {
    const res = await fetch(`/reference/demo-agent.jwk.json`);
    if (!res.ok) throw new Error(`could not load demo key (${res.status})`);
    demoKey = await res.json();
  }
  return demoKey;
}

/** Signs a request the same way Demo 1's console does — only @target-uri and
 * signature-agent are covered, so this works unchanged for GET or POST. */
async function signedHeaders(target) {
  const jwk = await loadKey();
  const signatureAgent = `sig1="${GATEWAY}";type=directory`;
  const now = new Date();
  const fields = await sign(
    new Request(target, { headers: { "Signature-Agent": signatureAgent } }),
    {
      signer: await signerFromJWK(jwk),
      created: now,
      expires: new Date(now.getTime() + 5 * 60_000),
      nonce: generateNonce(),
      target: "@target-uri",
      label: "sig1",
    },
  );
  return {
    "Signature-Input": fields.signatureInput,
    Signature: fields.signature,
    "Signature-Agent": signatureAgent,
  };
}

let lastCode = null;
let lastCodeFor = null;

async function requestCodeFor(email) {
  const target = GATEWAY + CODE_PATH;
  const headers = { "Content-Type": "application/json", ...(await signedHeaders(target)) };
  const res = await fetch(target, { method: "POST", headers, body: JSON.stringify({ acting_for: email }) });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.code) {
    lastCode = data.code;
    lastCodeFor = email;
  }
  return { res, data };
}

$("get-code").addEventListener("click", async () => {
  const email = emailOf();
  const out = $("code-result");
  out.textContent = "Requesting…";
  try {
    const { res, data } = await requestCodeFor(email);
    out.innerHTML = res.ok
      ? `Code for <b>${email}</b>: <code>${data.code}</code> — DEMO, a real deployment would email this instead. Expires in ${data.expires_in_seconds}s.`
      : `Could not get a code: ${data.detail || res.status}`;
  } catch (err) {
    out.textContent = `Error: ${err && err.message ? err.message : err}`;
  }
});

/* ---------- the actual protected-resource request ---------- */

async function buildRequest(scenario, email) {
  let code;
  if (scenario === "correct") {
    code = lastCode && lastCodeFor === email ? lastCode : (await requestCodeFor(email)).data.code;
  } else if (scenario === "wrong") {
    code = "000000";
  } // "none" — code stays undefined, header omitted entirely

  const target = GATEWAY + ACCOUNT_PATH;
  const headers = { Accept: "application/json", "X-Acting-For": email };
  if (code) headers["X-Delegation-Code"] = code;
  Object.assign(headers, await signedHeaders(target));
  return { target, headers };
}

const h = (name) => `<span class="h-name">${name}</span>`;

function renderRequest(target, headers) {
  const u = new URL(target);
  const lines = [`GET ${u.pathname} HTTP/1.1`, `${h("Host")}: ${u.host}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`${h(k)}: ${v}`);
  return lines.join("\n");
}

function curlFor(target, headers) {
  const parts = [`curl -i '${target}' \\`, `  -H 'Accept: application/json' \\`];
  if (headers["X-Acting-For"]) parts.push(`  -H 'X-Acting-For: ${headers["X-Acting-For"]}' \\`);
  if (headers["X-Delegation-Code"]) parts.push(`  -H 'X-Delegation-Code: ${headers["X-Delegation-Code"]}' \\`);
  parts.push(`  -H 'Signature-Input: ${headers["Signature-Input"]}' \\`);
  parts.push(`  -H 'Signature: ${headers["Signature"]}' \\`);
  parts.push(`  -H 'Signature-Agent: ${headers["Signature-Agent"]}'`);
  return parts.join("\n");
}

function setVerdict(kind, status, reason, facts) {
  const v = $("verdict");
  v.className = "verdict " + ({ ok: "is-ok", bad: "is-bad", warn: "is-warn" }[kind] || "");
  v.querySelector(".status").textContent = status;
  v.querySelector(".reason").textContent = reason;
  const dl = $("facts");
  dl.innerHTML = "";
  for (const [k, val] of facts) dl.insertAdjacentHTML("beforeend", `<dt>${k}</dt><dd>${val}</dd>`);
  dl.hidden = facts.length === 0;
}

function logLine(scenario, kind, text) {
  const cls = { ok: "v-ok", bad: "v-bad", warn: "v-warn" }[kind];
  $("log").insertAdjacentHTML(
    "afterbegin",
    `<li>${new Date().toLocaleTimeString()} · ${scenario} · <span class="${cls}">${text}</span></li>`,
  );
}

function interpret(httpStatus, data) {
  if (httpStatus === 200 && data.acting_for) {
    return {
      kind: "ok",
      status: "✅  GRANTED · 200",
      reason: "Correct code for the claimed email — access scoped to that person.",
      facts: [
        ["Acting for", data.acting_for],
        ["Tier", data.tier],
        ["Commission owed", `€${data.commission_owed}`],
      ],
    };
  }
  if (data.reason === "invalid-code") {
    return {
      kind: "bad",
      status: "⛔  REFUSED · 403",
      reason: data.detail || "Code doesn't match a live one for that email.",
      facts: [["Acting for", data.acting_for ?? "—"], ["Decision", "invalid-code"]],
    };
  }
  if (data.reason === "no-code") {
    return {
      kind: "warn",
      status: "⚠️  REFUSED · 401",
      reason: data.detail || "No code presented — an unverified claim.",
      facts: [["Acting for", data.acting_for ?? "—"], ["Decision", "no-code"]],
    };
  }
  return {
    kind: "bad",
    status: `⛔  IDENTITY REQUIRED · ${httpStatus}`,
    reason: data.detail || "Signature missing or invalid.",
    facts: [],
  };
}

async function send() {
  const scenario = scenarioOf();
  const email = emailOf();
  const btn = $("send");
  btn.disabled = true;
  $("verdict").className = "verdict";
  $("verdict").querySelector(".status").textContent = "… requesting";
  $("verdict").querySelector(".reason").textContent = "";

  try {
    const { target, headers } = await buildRequest(scenario, email);

    $("req-wire").innerHTML = renderRequest(target, headers);
    const curl = curlFor(target, headers);
    const copyBtn = $("copy-curl");
    copyBtn.hidden = false;
    copyBtn.onclick = () =>
      navigator.clipboard.writeText(curl).then(() => {
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => (copyBtn.textContent = "Copy as curl"), 1500);
      });

    const res = await fetch(target, { headers });
    const data = await res.json().catch(() => ({}));

    const r = interpret(res.status, data);
    setVerdict(r.kind, r.status, r.reason, r.facts);
    $("res-body").textContent = `HTTP/1.1 ${res.status} ${res.statusText}\n\n` + JSON.stringify(data, null, 2);

    const summary = r.kind === "ok" ? `GRANTED for ${data.acting_for}` : "REFUSED";
    logLine(scenario, r.kind, summary);
  } catch (err) {
    setVerdict("bad", "— Error", String(err && err.message ? err.message : err), []);
    $("res-body").textContent = "—";
  } finally {
    btn.disabled = false;
  }
}

$("send").addEventListener("click", send);

// Deep-link a pre-run state: /delegate/?send=correct|wrong|none
const preset = new URLSearchParams(location.search).get("send");
if (preset && ["correct", "wrong", "none"].includes(preset)) {
  const radio = document.querySelector(`input[name="scenario"][value="${preset}"]`);
  if (radio) {
    radio.checked = true;
    send();
  }
}
