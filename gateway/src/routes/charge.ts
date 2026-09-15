/**
 * GET /api/charge/report — the protected resource for Demo 4 (Charge).
 *
 * No signed identity involved here on purpose — Charge answers a question
 * that stands on its own: how does an agent pay for a resource, at all?
 * That's a different signature (EIP-712, over a payment authorization) from
 * Web Bot Auth's request signature, and mixing the two would blur the one
 * idea this demo exists to show.
 *
 *   no X-PAYMENT header               -> 402 + exactly what payment would satisfy this
 *   X-PAYMENT present, checks out     -> settle it for real, then 200 + resource + proof
 *   X-PAYMENT present, doesn't check  -> 402 again + why (still not paid)
 *
 * ?tier=premium prices the SAME resource far above what the demo wallet is
 * kept funded with — a genuine, reproducible "insufficient funds" decline
 * (a real on-chain simulate failure, not a scripted one). See docs/charge/.
 */
import { json, problem } from "../lib/http";
import { logAccess, type Env } from "../lib/log";
import {
  buildRequirement,
  decodePaymentHeader,
  relayerAccount,
  settlePayment,
  verifyPayment,
  USDC_DECIMALS,
  type PaymentRequirement,
} from "../lib/x402";

const SITE = "https://lab.eleviq.solutions";
const PATH = "/api/charge/report";

const TIERS: Record<string, { atomic: bigint; description: string }> = {
  standard: { atomic: 10_000n, description: "This week's agent-traffic signal report (standard tier)" },
  premium: {
    // Deliberately priced above any reasonable faucet drip (Circle's alone gives
    // 20 USDC per request) so this scenario stays a genuine decline regardless
    // of how well-funded the demo wallet ends up being — not tuned to a specific
    // balance that could silently drift into "affordable" again.
    atomic: 1_000_000_000n,
    description:
      "This week's agent-traffic signal report (premium tier — priced well above what the demo wallet is kept funded with, on purpose, to show a real decline)",
  },
};

const TEASER = {
  resource: "Agent-traffic signal report",
  access: "public",
  teaser: "A short read on what's actually hitting this lab's own endpoints this week. Full report requires payment.",
};

function fullReport() {
  return {
    resource: "Agent-traffic signal report",
    period: "2026-09-08 – 2026-09-14",
    headline: "Verified agent traffic up, most of it still declining to identify itself.",
    signals: [
      "A rising share of requests carry no identity at all — see the Identify demo.",
      "Declared purpose and actual behavior can't be reconciled from server logs alone.",
      "Paid access, even at fractions of a cent, is a usable signal filter: only requests that clear real cost show up here.",
    ],
    note: "Illustrative content for this demo — not a claim about real eleviq.solutions traffic. See the Measure demos for the real dashboards.",
  };
}

export async function handleCharge(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const tierName = url.searchParams.get("tier") === "premium" ? "premium" : "standard";
  const tier = TIERS[tierName];
  const resourceUrl = new URL(PATH, url.origin);
  resourceUrl.searchParams.set("tier", tierName);

  if (!env.CHARGE_RELAYER_KEY) {
    return json({ error: "gateway_misconfigured", detail: "CHARGE_RELAYER_KEY is not set." }, 500);
  }
  const relayer = relayerAccount(env.CHARGE_RELAYER_KEY as `0x${string}`);

  const requirement: PaymentRequirement = buildRequirement({
    amountAtomic: tier.atomic,
    resource: resourceUrl.toString(),
    description: tier.description,
    payTo: relayer.address,
  });

  const paymentHeader = request.headers.get("X-PAYMENT");

  if (!paymentHeader) {
    logAccess(env, ctx, { path: PATH, outcome: "verified", status: 402, chargeStatus: "payment-required", chargeAmount: requirement.maxAmountRequired });
    return json(
      { x402Version: 1, accepts: [requirement], teaser: TEASER },
      402,
    );
  }

  const payment = decodePaymentHeader(paymentHeader);
  if (!payment) {
    logAccess(env, ctx, { path: PATH, outcome: "verified", status: 402, chargeStatus: "malformed-payment" });
    return problem(402, {
      type: `${SITE}/charge/#malformed-payment`,
      title: "X-PAYMENT header could not be parsed",
      detail: "Expected base64-encoded x402 payment payload JSON.",
      accepts: [requirement],
    });
  }

  const verdict = await verifyPayment(payment, requirement, relayer);
  if (!verdict.ok) {
    logAccess(env, ctx, {
      path: PATH,
      outcome: "verified",
      status: 402,
      chargeStatus: verdict.reason,
      chargeAmount: requirement.maxAmountRequired,
    });
    return problem(402, {
      type: `${SITE}/charge/#${verdict.reason}`,
      title: "Payment did not go through",
      detail: verdict.detail,
      reason: verdict.reason,
      accepts: [requirement],
    });
  }

  try {
    const settlement = await settlePayment(env.CHARGE_RELAYER_KEY as `0x${string}`, verdict.simulatedRequest);
    logAccess(env, ctx, {
      path: PATH,
      outcome: "verified",
      status: 200,
      chargeStatus: "paid",
      chargeAmount: requirement.maxAmountRequired,
      chargeTxHash: settlement.hash,
    });
    const paymentResponse = btoa(
      JSON.stringify({ success: true, transaction: settlement.hash, network: requirement.network, payer: payment.payload.authorization.from }),
    );
    return json(
      {
        ...fullReport(),
        payment: {
          amount_atomic: requirement.maxAmountRequired,
          amount_usdc: (Number(requirement.maxAmountRequired) / 10 ** USDC_DECIMALS).toFixed(6),
          asset: requirement.asset,
          network: requirement.network,
          payer: payment.payload.authorization.from,
          payTo: requirement.payTo,
          transaction: settlement.hash,
          explorer: `https://sepolia.basescan.org/tx/${settlement.hash}`,
        },
      },
      200,
      { "X-PAYMENT-RESPONSE": paymentResponse },
    );
  } catch (err) {
    logAccess(env, ctx, { path: PATH, outcome: "verified", status: 402, chargeStatus: "settlement-failed" });
    return problem(402, {
      type: `${SITE}/charge/#settlement-failed`,
      title: "Payment verified but settlement failed on-chain",
      detail: String((err as Error)?.message ?? err),
      accepts: [requirement],
    });
  }
}
