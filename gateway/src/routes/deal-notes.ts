/**
 * GET /api/decide/deal-notes — the protected resource for Demo 2 (Decide).
 *
 *   verified agent, permitted purpose declared  ->  200 + full deal notes
 *   verified agent, prohibited purpose declared ->  403 purpose-prohibited
 *   verified agent, no purpose declared         ->  403 purpose-undeclared
 *   anything else (identity fails)              ->  401, same as Demo 1
 *
 * Identity is checked first, exactly as in Demo 1 — Decide answers a
 * different question ("is this allowed?"), not "who is this?" again.
 */
import { checkIdentity } from "../lib/verify";
import { json, problem } from "../lib/http";
import { logAccess, type Env } from "../lib/log";
import { decide, ALL_USAGE_TYPES, PURPOSE_HEADER } from "../lib/policy";

const SITE = "https://lab.eleviq.solutions";
const PATH = "/api/decide/deal-notes";

const TEASER = {
  resource: "Q3 sales notes",
  access: "public",
  teaser:
    "Internal notes on how far the sales team discounted to win or lose three named deals last quarter. Full detail requires a verified agent declaring a permitted purpose.",
};

const FULL_NOTES = {
  resource: "Q3 sales notes",
  access: "verified-agent, permitted-purpose",
  currency: "EUR",
  deals: [
    {
      competitor: "Northwind Analytics",
      outcome: "won",
      list_price: 48000,
      closed_price: 34500,
      discount_pct: 28,
      notes: "Matched their bundled-support offer; floor was 30% off.",
    },
    {
      competitor: "Basecamp Ledger",
      outcome: "lost",
      list_price: 22000,
      closed_price: null,
      discount_pct: null,
      notes: "Walked at 22% off; they went to 35%. Don't chase this account below 25% again.",
    },
    {
      competitor: "Northwind Analytics",
      outcome: "won",
      list_price: 61000,
      closed_price: 48800,
      discount_pct: 20,
      notes: "No further discount needed — they were weak on integrations.",
    },
  ],
  floor_guidance: "Do not discount below 30% against Northwind without VP approval.",
  valid_until: "2026-09-30",
};

export async function handleDealNotes(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const verdict = await checkIdentity(request, env);

  if (!verdict.ok) {
    logAccess(env, ctx, { path: PATH, outcome: verdict.reason, status: 401, keyid: verdict.keyid });
    return problem(
      401,
      {
        type: `${SITE}/decide/#${verdict.reason}`,
        title: "Verified agent identity required",
        detail: verdict.detail,
        reason: verdict.reason,
        teaser: TEASER,
        how_to_authenticate: {
          see: `${SITE}/identity/`,
          note: "Demo 2 reuses the same Web Bot Auth identity check as Demo 1 — see that demo for how to sign a request.",
        },
      },
      { "www-authenticate": 'Signature realm="eleviq-lab", scheme="web-bot-auth"' },
    );
  }

  const outcome = decide(request.headers.get(PURPOSE_HEADER), new URL(request.url).origin);

  if (outcome.decision === "allow") {
    logAccess(env, ctx, {
      path: PATH,
      outcome: "verified",
      status: 200,
      keyid: verdict.keyid,
      agentName: verdict.agent.name,
      agentOperator: verdict.agent.operator,
      trustTier: verdict.tier,
      purpose: outcome.purpose,
      policyDecision: "allow",
      policyReason: null,
    });
    return json({
      ...FULL_NOTES,
      policy: { declared_purpose: outcome.purpose, decision: "allow" },
      verified: {
        agent: verdict.agent.name,
        operator: verdict.agent.operator,
        keyid: verdict.keyid,
        trust_tier: verdict.tier,
      },
    });
  }

  logAccess(env, ctx, {
    path: PATH,
    outcome: "verified",
    status: 403,
    keyid: verdict.keyid,
    agentName: verdict.agent.name,
    agentOperator: verdict.agent.operator,
    trustTier: verdict.tier,
    purpose: outcome.purpose,
    policyDecision: "deny",
    policyReason: outcome.reason,
  });
  return problem(403, {
    type: `${SITE}/decide/#${outcome.reason}`,
    title:
      outcome.reason === "purpose-prohibited"
        ? "Declared purpose is prohibited by this resource's stated policy"
        : "No purpose declared — default is deny",
    detail:
      outcome.reason === "purpose-prohibited"
        ? `You are a verified, trusted agent (${verdict.agent.name}) — but you declared "${outcome.purpose}" as your purpose, and this resource's policy prohibits that use. Identity is not authorization.`
        : `No ${PURPOSE_HEADER} header was sent. This gateway does not assume permission when intent isn't stated.`,
    reason: outcome.reason,
    declared_purpose: outcome.purpose,
    teaser: TEASER,
    policy_reference: {
      license: new URL("/.well-known/rsl.xml", request.url).toString(),
      purpose_header: PURPOSE_HEADER,
      accepted_values: ALL_USAGE_TYPES,
    },
  });
}
