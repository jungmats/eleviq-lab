/**
 * ElevIQ Lab — x402 reference payer.
 *
 * The real client-side code path an agent implements to pay for a 402'd
 * resource: fetch the price, sign an EIP-3009 authorization for it, resend
 * with that signature attached. ~50 lines, no framework beyond viem.
 *
 * Setup:
 *   mkdir charge && cd charge
 *   npm init -y && npm install viem
 *   curl -O https://lab.eleviq.solutions/reference/charge-pay.mjs
 *   curl -O https://lab.eleviq.solutions/reference/charge-agent.json
 *
 * Use:
 *   node charge-pay.mjs [--tier standard|premium] [--key charge-agent.json]
 *
 *   --tier     which price to request (default standard — premium is
 *              deliberately priced above what the demo wallet holds, to show
 *              a real decline)
 *   --key      path to a JSON file with { address, privateKey } (default
 *              charge-agent.json — the lab's published demo wallet)
 *   --gateway  gateway base URL (default the deployed one)
 */
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const GATEWAY = arg("gateway", "https://eleviq-lab-gateway.gateway-worker.workers.dev");
const tier = arg("tier", "standard");
const keyPath = arg("key", "charge-agent.json");

const { privateKey } = JSON.parse(readFileSync(keyPath, "utf8"));
const account = privateKeyToAccount(privateKey);

// 1 — ask for the resource; expect 402 with the price
const target = `${GATEWAY}/api/charge/report?tier=${tier}`;
const quoteRes = await fetch(target);
const quote = await quoteRes.json();
if (quoteRes.status !== 402) {
  console.log(`${quoteRes.status} — already got a response without paying?`, quote);
  process.exit(0);
}
const requirement = quote.accepts[0];
console.log(`402 — ${requirement.description}, ${Number(requirement.maxAmountRequired) / 1e6} USDC to ${requirement.payTo}`);

// 2 — sign an EIP-3009 transferWithAuthorization for exactly that amount
const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: account.address,
  to: requirement.payTo,
  value: requirement.maxAmountRequired,
  validAfter: "0",
  validBefore: String(now + requirement.maxTimeoutSeconds),
  nonce,
};
const signature = await account.signTypedData({
  domain: { name: requirement.extra.name, version: requirement.extra.version, chainId: 84532, verifyingContract: requirement.asset },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
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

// 3 — resend with the signed payment attached
const payment = { x402Version: 1, scheme: "exact", network: "base-sepolia", payload: { signature, authorization } };
const header = Buffer.from(JSON.stringify(payment)).toString("base64");

const payRes = await fetch(target, { headers: { "X-PAYMENT": header } });
const body = await payRes.json();
console.log(`\n${payRes.status} ${payRes.statusText}`);
console.log(JSON.stringify(body, null, 2));
if (payRes.status === 200) console.log(`\nSettled: ${body.payment.explorer}`);
