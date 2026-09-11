/* ElevIQ Lab — Demo 1 console.
 *
 * Real Web Bot Auth: this script signs the request in your browser with a demo
 * Ed25519 key (web-bot-auth, bundled into agent-sign.js) and sends it to the
 * gateway Worker, which verifies it. Nothing is simulated.
 *
 * The gateway is a separate origin (the reference artifact). Its URL comes from
 * <meta name="gateway"> so it can be repointed without touching this file.
 *
 * "Claimed" vs "Verified": signing always uses the ONE demo-agent key — the
 * dropdown only sets what the request CLAIMS to be (via X-Demo-Agent-Claim,
 * since browsers won't let a script set User-Agent; curl would use
 * -H 'User-Agent: …'). The verified identity comes from the key, so with
 * "Valid signature" the claim and the verified identity are deliberately
 * different — that gap IS the point: a signature proves key possession, not
 * whatever name the request happens to claim.
 */
import { sign, generateNonce, signerFromJWK } from "./agent-sign.js";

const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const GATEWAY = (
  LOCAL
    ? "http://localhost:8787"
    : document.querySelector('meta[name="gateway"]')?.content ||
      "https://eleviq-lab-gateway.gateway-worker.workers.dev"
).replace(/\/+$/, "");
const PATH = "/api/identity/price-list";

const $ = (id) => document.getElementById(id);
const scenarioOf = () => document.querySelector('input[name="scenario"]:checked').value;
const uaOf = () => $("ua").value;

const keyCache = new Map();
async function loadKey(name) {
  if (!keyCache.has(name)) {
    const res = await fetch(`/reference/${name}.jwk.json`);
    if (!res.ok) throw new Error(`could not load demo key ${name} (${res.status})`);
    keyCache.set(name, await res.json());
  }
  return keyCache.get(name);
}

async function buildRequest(scenario, ua) {
  const target = GATEWAY + PATH;
  const headers = { Accept: "application/json", "X-Demo-Agent-Claim": ua };
  if (scenario === "unsigned") return { target, headers };

  // Always signs as the one "ElevIQ Lab demo agent" key — the dropdown never
  // changes which key signs, only what the request claims (see file header).
  const keyName = scenario === "unknown-key" ? "untrusted-agent" : "demo-agent";
  const jwk = await loadKey(keyName);
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

function curlFor(target, headers, ua, signed) {
  const parts = [`curl -i '${target}' \\`, `  -H 'User-Agent: ${ua}' \\`, `  -H 'Accept: application/json'`];
  if (signed) {
    parts[parts.length - 1] += " \\";
    parts.push(`  -H 'Signature-Input: ${headers["Signature-Input"]}' \\`);
    parts.push(`  -H 'Signature: ${headers["Signature"]}' \\`);
    parts.push(`  -H 'Signature-Agent: ${headers["Signature-Agent"]}'`);
  }
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

function interpret(scenario, ua, httpStatus, data) {
  if (httpStatus === 200 && data.verified) {
    const v = data.verified;
    return {
      kind: "ok",
      status: "✅  VERIFIED · 200",
      reason:
        "Signature valid and key found in a trusted directory. Full resource served. " +
        "Note: verified identity comes from the KEY, not the claim below — they can differ.",
      facts: [
        ["Claimed", ua],
        ["Verified as", v.agent + ` (${v.operator})`],
        ["Key ID", v.keyid],
        ["Signed at", new Date(v.signed_at).toLocaleTimeString()],
        ["Expires", new Date(v.expires).toLocaleTimeString()],
      ],
    };
  }
  const reason = data.reason || "invalid";
  if (reason === "unsigned") {
    return {
      kind: "bad",
      status: "⛔  REFUSED · 401",
      reason: data.detail || "No signature — identity cannot be verified.",
      facts: [
        ["Claimed", ua],
        ["Verified as", "—"],
        ["Signature", "absent"],
      ],
    };
  }
  if (reason === "unknown-key") {
    return {
      kind: "warn",
      status: "⚠️  REJECTED · 401",
      reason: data.detail || "Signature valid, but the key is not trusted.",
      facts: [
        ["Claimed", ua],
        ["Verified as", "—"],
        ["Key ID", data.keyid || "—"],
        ["Signature", "well-formed, key not in directory"],
      ],
    };
  }
  return {
    kind: "warn",
    status: `⚠️  REJECTED · ${httpStatus}`,
    reason: data.detail || "Signature did not verify.",
    facts: [["Claimed", ua], ["Reason", reason]],
  };
}

async function send() {
  const scenario = scenarioOf();
  const ua = uaOf();
  const btn = $("send");
  btn.disabled = true;
  $("verdict").className = "verdict";
  $("verdict").querySelector(".status").textContent = "… signing and sending";
  $("verdict").querySelector(".reason").textContent = "";

  try {
    const { target, headers } = await buildRequest(scenario, ua);
    const signed = scenario !== "unsigned";

    $("req-wire").innerHTML = renderRequest(target, headers);
    const curl = curlFor(target, headers, ua, signed);
    const copyBtn = $("copy-curl");
    copyBtn.hidden = false;
    copyBtn.onclick = () =>
      navigator.clipboard.writeText(curl).then(() => {
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => (copyBtn.textContent = "Copy as curl"), 1500);
      });

    const res = await fetch(target, { headers });
    const data = await res.json().catch(() => ({}));

    const r = interpret(scenario, ua, res.status, data);
    setVerdict(r.kind, r.status, r.reason, r.facts);
    $("res-body").textContent = `HTTP/1.1 ${res.status} ${res.statusText}\n\n` + JSON.stringify(data, null, 2);

    const summary =
      r.kind === "ok" ? `VERIFIED as ${data.verified.agent} (${data.verified.operator})`
      : r.kind === "warn" ? "REJECTED — untrusted key"
      : "REFUSED — no signature";
    logLine(scenario, r.kind, summary);
  } catch (err) {
    setVerdict("bad", "— Error", String(err && err.message ? err.message : err), []);
    $("res-body").textContent = "—";
  } finally {
    btn.disabled = false;
  }
}

$("send").addEventListener("click", send);

// Deep-link a pre-run state: /identity/?send=valid|unsigned|unknown-key
const preset = new URLSearchParams(location.search).get("send");
if (preset && ["valid", "unsigned", "unknown-key"].includes(preset)) {
  const radio = document.querySelector(`input[name="scenario"][value="${preset}"]`);
  if (radio) {
    radio.checked = true;
    send();
  }
}
