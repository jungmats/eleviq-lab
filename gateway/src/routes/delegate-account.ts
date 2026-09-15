/**
 * GET /api/delegate/account — the protected resource for Demo 3 (Delegate).
 *
 *   valid code for the claimed email  ->  200 + that email's account statement
 *   wrong/expired/reused code         ->  403 delegation invalid
 *   no code presented at all          ->  401 delegation required
 *   identity itself fails             ->  401, same as Demo 1
 */
import { checkIdentity } from "../lib/verify";
import { json, problem } from "../lib/http";
import { logAccess, type Env } from "../lib/log";
import { checkDelegation } from "../lib/delegation";

const SITE = "https://lab.eleviq.solutions";
const PATH = "/api/delegate/account";

const TEASER = {
  resource: "Reseller account statement",
  access: "public",
  teaser:
    "Commission owed and next payout date for one specific partner account. Full detail requires proving the request is acting for that partner.",
};

function fullStatement(actingFor: string) {
  return {
    resource: "Reseller account statement",
    access: "delegated-user",
    acting_for: actingFor,
    tier: "Reseller",
    currency: "EUR",
    commission_owed: 4320,
    last_payout: "2026-08-31",
    next_payout: "2026-09-30",
  };
}

export async function handleAccount(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const verdict = await checkIdentity(request, env);

  if (!verdict.ok) {
    logAccess(env, ctx, { path: PATH, outcome: verdict.reason, status: 401, keyid: verdict.keyid });
    return problem(
      401,
      {
        type: `${SITE}/delegate/#${verdict.reason}`,
        title: "Verified agent identity required",
        detail: verdict.detail,
        reason: verdict.reason,
        teaser: TEASER,
      },
      { "www-authenticate": 'Signature realm="eleviq-lab", scheme="web-bot-auth"' },
    );
  }

  const delegation = await checkDelegation(
    env,
    request.headers.get("X-Acting-For"),
    request.headers.get("X-Delegation-Code"),
  );

  if (delegation.outcome === "granted") {
    logAccess(env, ctx, {
      path: PATH,
      outcome: "verified",
      status: 200,
      keyid: verdict.keyid,
      agentName: verdict.agent.name,
      agentOperator: verdict.agent.operator,
      trustTier: verdict.tier,
      actingFor: delegation.actingFor,
      delegationOutcome: "granted",
    });
    return json({
      ...fullStatement(delegation.actingFor),
      verified: { agent: verdict.agent.name, operator: verdict.agent.operator, keyid: verdict.keyid },
    });
  }

  const status = delegation.outcome === "no-code" ? 401 : 403;
  logAccess(env, ctx, {
    path: PATH,
    outcome: "verified",
    status,
    keyid: verdict.keyid,
    agentName: verdict.agent.name,
    agentOperator: verdict.agent.operator,
    trustTier: verdict.tier,
    actingFor: delegation.actingFor,
    delegationOutcome: delegation.outcome,
  });
  const titles = {
    "no-code": "No delegation code presented",
    "already-used": "Delegation code already used",
    "invalid-code": "Delegation code doesn't match",
  };
  const details = {
    "no-code":
      "This resource is scoped to a specific person. Claim who you're acting for (X-Acting-For) and present a code obtained via POST /api/delegate/request-code (X-Delegation-Code).",
    "already-used": `The code presented for "${delegation.actingFor}" was already used. Codes are single-use — request a fresh one.`,
    "invalid-code": `The code presented for "${delegation.actingFor}" doesn't match a live one — wrong, expired, or never issued. Request a fresh one.`,
  };
  return problem(status, {
    type: `${SITE}/delegate/#${delegation.outcome}`,
    title: titles[delegation.outcome],
    detail: details[delegation.outcome],
    reason: delegation.outcome,
    acting_for: delegation.actingFor,
    teaser: TEASER,
    how_to_delegate: {
      request_code: new URL("/api/delegate/request-code", request.url).toString(),
      note: "DEMO — a real deployment would email the code instead of returning it from that endpoint.",
    },
  });
}
