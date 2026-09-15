/* ElevIQ Lab — Demo 4 (Charge) console.
 *
 * Real x402 payment: an EIP-712 signature made in this browser with a
 * published demo wallet's private key (same "publish the key on purpose"
 * convention as Demo 1's demo-agent.jwk.json — see reference/charge-agent.json),
 * a real read of Base Sepolia for balances, and a real settlement performed
 * by the gateway (which plays a self-hosted facilitator — see
 * gateway/src/lib/x402.ts). Nothing here is simulated; the network is a free
 * testnet so nothing of value is at stake.
 *
 * The gateway is a separate origin. Its URL comes from <meta name="gateway">
 * so it can be repointed without touching this file.
 */
import { createPublicClient, http, parseAbi, baseSepolia, privateKeyToAccount } from "./charge-sign.js";

const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const GATEWAY = (
  LOCAL
    ? "http://localhost:8787"
    : document.querySelector('meta[name="gateway"]')?.content ||
      "https://eleviq-lab-gateway.gateway-worker.workers.dev"
).replace(/\/+$/, "");
const PATH = "/api/charge/report";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_DECIMALS = 6;
const USDC_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const $ = (id) => document.getElementById(id);

/* ---------- wallet + balances ---------- */

let account = null;
async function getAccount() {
  if (!account) {
    const res = await fetch("/reference/charge-agent.json");
    if (!res.ok) throw new Error(`could not load demo wallet (${res.status})`);
    const key = await res.json();
    account = privateKeyToAccount(key.privateKey);
  }
  return account;
}

async function usdcBalance(address) {
  return publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [address] });
}

function fmtUsdc(atomic) {
  return `${(Number(atomic) / 10 ** USDC_DECIMALS).toFixed(6)} USDC`;
}

let payToAddress = null;
let lastBalances = { agent: null, payTo: null };

async function refreshBalances() {
  const acc = await getAccount();
  $("bal-agent-addr").textContent = acc.address;
  const agentBal = await usdcBalance(acc.address);
  renderBalanceCell("bal-agent", agentBal, lastBalances.agent);
  lastBalances.agent = agentBal;

  if (payToAddress) {
    $("bal-payto-addr").textContent = payToAddress;
    const payToBal = await usdcBalance(payToAddress);
    renderBalanceCell("bal-payto", payToBal, lastBalances.payTo);
    lastBalances.payTo = payToBal;
  }
}

function renderBalanceCell(id, current, previous) {
  let html = fmtUsdc(current);
  if (previous !== null && current !== previous) {
    const diff = current - previous;
    const cls = diff > 0n ? "up" : "down";
    const sign = diff > 0n ? "+" : "−";
    html += `<span class="delta ${cls}">${sign}${fmtUsdc(diff < 0n ? -diff : diff).replace(" USDC", "")} USDC since last run</span>`;
  }
  $(id).innerHTML = html;
}

/* ---------- protocol: quote, sign, pay ---------- */

async function fetchQuote(tier) {
  const target = `${GATEWAY}${PATH}?tier=${tier}`;
  const res = await fetch(target);
  const body = await res.json().catch(() => ({}));
  return { target, status: res.status, body };
}

async function signPayment(requirement) {
  const acc = await getAccount();
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = "0x" + [...nonceBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: acc.address,
    to: requirement.payTo,
    value: requirement.maxAmountRequired,
    validAfter: "0",
    validBefore: String(now + requirement.maxTimeoutSeconds),
    nonce,
  };
  const signature = await acc.signTypedData({
    domain: {
      name: requirement.extra.name,
      version: requirement.extra.version,
      chainId: baseSepolia.id,
      verifyingContract: requirement.asset,
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: 0n,
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
  return { x402Version: 1, scheme: "exact", network: requirement.network, payload: { signature, authorization } };
}

const encodeHeader = (payment) => btoa(JSON.stringify(payment));

async function payWithHeader(target, headerValue) {
  const res = await fetch(target, { headers: { "X-PAYMENT": headerValue } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, paymentResponse: res.headers.get("X-PAYMENT-RESPONSE") };
}

/* ---------- rendering ---------- */

function renderExchangeStep(label, target, headers, status, bodyText) {
  const lines = [`GET ${new URL(target).pathname}${new URL(target).search} HTTP/1.1`, `Host: ${new URL(target).host}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v.length > 80 ? v.slice(0, 80) + "…" : v}`);
  const html = `
    <div class="exchange-step">
      <p class="step-label">${label}</p>
      <div class="exchange">
        <div class="req">
          <p class="pane-title">What the agent sent</p>
          <pre class="wire">${lines.join("\n")}</pre>
        </div>
        <div class="res">
          <p class="pane-title">What the server returned</p>
          <pre class="wire">HTTP/1.1 ${status}\n\n${bodyText}</pre>
        </div>
      </div>
    </div>`;
  $("exchanges").insertAdjacentHTML("beforeend", html);
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

function logLine(mode, kind, text) {
  const cls = { ok: "v-ok", bad: "v-bad", warn: "v-warn" }[kind];
  $("log").insertAdjacentHTML(
    "afterbegin",
    `<li>${new Date().toLocaleTimeString()} · ${mode} · <span class="${cls}">${text}</span></li>`,
  );
}

/* ---------- scenario runner ---------- */

let lastPayment = null; // { target, header } — for the replay scenario

async function run() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const btn = $("send");
  btn.disabled = true;
  $("exchanges").innerHTML = "";
  setVerdict("", "… running", "", []);

  try {
    if (mode === "pay" || mode === "insufficient") {
      const tier = mode === "pay" ? "standard" : "premium";
      const quote = await fetchQuote(tier);
      renderExchangeStep("1 · Request without payment", quote.target, {}, quote.status, JSON.stringify(quote.body, null, 2));

      if (quote.status !== 402 || !quote.body.accepts?.[0]) {
        setVerdict("bad", "— Unexpected response", "Expected a 402 quote here.", []);
        return;
      }
      const requirement = quote.body.accepts[0];
      if (!payToAddress) {
        payToAddress = requirement.payTo;
        await refreshBalances();
      }

      const payment = await signPayment(requirement);
      const header = encodeHeader(payment);
      const result = await payWithHeader(quote.target, header);
      renderExchangeStep(
        "2 · Request with a signed X-PAYMENT",
        quote.target,
        { "X-PAYMENT": header },
        result.status,
        JSON.stringify(result.body, null, 2),
      );

      if (result.status === 200) {
        lastPayment = { target: quote.target, header };
        await refreshBalances();
        const p = result.body.payment;
        setVerdict("ok", "✅  PAID · 200", "Signature verified, settlement confirmed on Base Sepolia.", [
          ["Amount", `${p.amount_usdc} USDC`],
          [
            "Transaction",
            `<a href="${p.explorer}" target="_blank" rel="noopener">${p.transaction.slice(0, 14)}… ↗</a> — independently checkable on Base Sepolia's own explorer, not this page's word for it`,
          ],
        ]);
        logLine(mode, "ok", "PAID");
      } else {
        await refreshBalances();
        const kind = mode === "insufficient" ? "bad" : "bad";
        setVerdict(kind, `⛔  DECLINED · ${result.status}`, result.body.detail || "Payment did not go through.", [
          ["Reason", result.body.reason || "—"],
        ]);
        logLine(mode, kind, mode === "insufficient" ? "DECLINED — insufficient funds" : "DECLINED");
      }
    } else if (mode === "replay") {
      if (!lastPayment) {
        setVerdict("warn", "⚠️  Nothing to replay yet", "Run \"Pay the real price\" first — this replays that exact payment.", []);
        logLine(mode, "warn", "SKIPPED — no prior payment");
        return;
      }
      const result = await payWithHeader(lastPayment.target, lastPayment.header);
      renderExchangeStep(
        "1 · Replaying the exact payment from your last successful run",
        lastPayment.target,
        { "X-PAYMENT": lastPayment.header },
        result.status,
        JSON.stringify(result.body, null, 2),
      );
      await refreshBalances();
      if (result.status === 200) {
        // Shouldn't happen — EIP-3009's own on-chain nonce tracking should block this.
        setVerdict("warn", "⚠️  Unexpectedly succeeded", "This should have been rejected as already used.", []);
        logLine(mode, "warn", "UNEXPECTED 200");
      } else {
        setVerdict("bad", `⛔  REJECTED · ${result.status}`, result.body.detail || "Already used.", [
          ["Reason", result.body.reason || "—"],
          ["Note", "The token contract itself tracks this — not something this gateway has to remember."],
        ]);
        logLine(mode, "bad", "REJECTED — already used");
      }
    }
  } catch (err) {
    setVerdict("bad", "— Error", String(err && err.message ? err.message : err), []);
  } finally {
    btn.disabled = false;
  }
}

$("send").addEventListener("click", run);

/* ---------- initial live state ---------- */
// Silently learns payTo's address (only known once a quote is fetched) so
// the balance panel can show both wallets before any scenario is run.

(async () => {
  try {
    const quote = await fetchQuote("standard");
    if (quote.body.accepts?.[0]) payToAddress = quote.body.accepts[0].payTo;
  } catch {
    // Balance panel just stays on "Loading…" — not fatal, no visible quote panel depends on this.
  }
  try {
    await refreshBalances();
  } catch (err) {
    $("bal-agent").textContent = `Error: ${err}`;
  }
})();

// Deep-link a pre-run scenario: /charge/?run=pay|insufficient|replay
const preset = new URLSearchParams(location.search).get("run");
if (preset && ["pay", "insufficient", "replay"].includes(preset)) {
  const radio = document.querySelector(`input[name="mode"][value="${preset}"]`);
  if (radio) {
    radio.checked = true;
    // wait for the initial balance/quote load above before running
    setTimeout(run, 400);
  }
}
