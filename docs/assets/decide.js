/* ElevIQ Lab — Demo 2 (Decide) console.
 *
 * Identity is fixed here — every request signs with the same trusted
 * "ElevIQ Lab demo agent" key Demo 1 uses (see console.js / agent-sign.js for
 * that story). The only thing this console varies is the DECLARED PURPOSE,
 * sent as a genuine X-Agent-Purpose request header — this lab's own
 * convention, not a ratified standard, but using RSL's own usage vocabulary
 * (search / ai-input / ai-train).
 *
 * The gateway is a separate origin. Its URL comes from <meta name="gateway">
 * so it can be repointed without touching this file.
 */
import { sign, generateNonce, signerFromJWK } from "./agent-sign.js";

const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const GATEWAY = (
  LOCAL
    ? "http://localhost:8787"
    : document.querySelector('meta[name="gateway"]')?.content ||
      "https://eleviq-lab-gateway.gateway-worker.workers.dev"
).replace(/\/+$/, "");
const PATH = "/api/decide/deal-notes";
const PURPOSE_HEADER = "X-Agent-Purpose";

const $ = (id) => document.getElementById(id);
const purposeOf = () => document.querySelector('input[name="purpose"]:checked').value;

let demoKey = null;
async function loadKey() {
  if (!demoKey) {
    const res = await fetch(`/reference/demo-agent.jwk.json`);
    if (!res.ok) throw new Error(`could not load demo key (${res.status})`);
    demoKey = await res.json();
  }
  return demoKey;
}

async function buildRequest(purpose) {
  const target = GATEWAY + PATH;
  const headers = { Accept: "application/json" };
  if (purpose !== "undeclared") headers[PURPOSE_HEADER] = purpose;

  // Always signs as the one "ElevIQ Lab demo agent" key — the purpose radios
  // never change which key signs, only what the request declares (see file
  // header). This is deliberate: Demo 1 already owns the identity story.
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
  headers["Signature-Input"] = fields.signatureInput;
  headers["Signature"] = fields.signature;
  headers["Signature-Agent"] = signatureAgent;
  return { target, headers };
}

/* ---------- rendering ---------- */

const h = (name) => `<span class="h-name">${name}</span>`;

function renderRequest(target, headers) {
  const u = new URL(target);
  const lines = [`GET ${u.pathname} HTTP/1.1`, `${h("Host")}: ${u.host}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`${h(k)}: ${v}`);
  return lines.join("\n");
}

function curlFor(target, headers) {
  const parts = [`curl -i '${target}' \\`, `  -H 'Accept: application/json' \\`];
  if (headers[PURPOSE_HEADER]) parts.push(`  -H '${PURPOSE_HEADER}: ${headers[PURPOSE_HEADER]}' \\`);
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

function logLine(purpose, kind, text) {
  const cls = { ok: "v-ok", bad: "v-bad", warn: "v-warn" }[kind];
  $("log").insertAdjacentHTML(
    "afterbegin",
    `<li>${new Date().toLocaleTimeString()} · ${purpose} · <span class="${cls}">${text}</span></li>`,
  );
}

function interpret(purpose, httpStatus, data) {
  if (httpStatus === 200 && data.policy?.decision === "allow") {
    return {
      kind: "ok",
      status: "✅  ALLOWED · 200",
      reason: "Verified, trusted agent; declared purpose is permitted by the stated policy. Full resource served.",
      facts: [
        ["Declared purpose", purpose],
        ["Decision", "allow"],
        ["Verified as", `${data.verified.agent} (${data.verified.operator})`],
      ],
    };
  }
  const reason = data.reason;
  if (reason === "purpose-prohibited") {
    return {
      kind: "bad",
      status: "⛔  REFUSED · 403",
      reason: data.detail || "Declared purpose is prohibited by the stated policy.",
      facts: [
        ["Declared purpose", data.declared_purpose ?? purpose],
        ["Decision", "deny — purpose-prohibited"],
        ["Identity", "verified (same key as the allowed case)"],
      ],
    };
  }
  if (reason === "purpose-undeclared") {
    return {
      kind: "warn",
      status: "⚠️  REFUSED · 403",
      reason: data.detail || "No purpose declared — default is deny.",
      facts: [
        ["Declared purpose", "— (no header sent)"],
        ["Decision", "deny — purpose-undeclared"],
        ["Note", "No stated intent is not treated as permission."],
      ],
    };
  }
  // Identity itself failed (401) — same reasons as Demo 1.
  return {
    kind: "bad",
    status: `⛔  IDENTITY REQUIRED · ${httpStatus}`,
    reason: data.detail || "Signature missing or invalid — Demo 2 requires the same verified identity as Demo 1.",
    facts: [["Declared purpose", purpose], ["Reason", reason || "—"]],
  };
}

async function send() {
  const purpose = purposeOf();
  const btn = $("send");
  btn.disabled = true;
  $("verdict").className = "verdict";
  $("verdict").querySelector(".status").textContent = "… signing and sending";
  $("verdict").querySelector(".reason").textContent = "";

  try {
    const { target, headers } = await buildRequest(purpose);

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

    const r = interpret(purpose, res.status, data);
    setVerdict(r.kind, r.status, r.reason, r.facts);
    $("res-body").textContent = `HTTP/1.1 ${res.status} ${res.statusText}\n\n` + JSON.stringify(data, null, 2);

    const summary =
      r.kind === "ok" ? "ALLOWED"
      : r.kind === "warn" ? "REFUSED — no purpose declared"
      : "REFUSED";
    logLine(purpose, r.kind, summary);
  } catch (err) {
    setVerdict("bad", "— Error", String(err && err.message ? err.message : err), []);
    $("res-body").textContent = "—";
  } finally {
    btn.disabled = false;
  }
}

$("send").addEventListener("click", send);

/* ---------- stated policy panel (§3) ---------- */

async function loadStatedPolicy() {
  try {
    const res = await fetch(GATEWAY + "/.well-known/rsl.xml");
    $("stated-rsl").textContent = await res.text();
  } catch (err) {
    $("stated-rsl").textContent = `Could not fetch: ${err}`;
  }
}
loadStatedPolicy();

// Deep-link a pre-run state: /decide/?send=ai-input|ai-train|undeclared
const preset = new URLSearchParams(location.search).get("send");
if (preset && ["ai-input", "ai-train", "undeclared"].includes(preset)) {
  const radio = document.querySelector(`input[name="purpose"][value="${preset}"]`);
  if (radio) {
    radio.checked = true;
    send();
  }
}
