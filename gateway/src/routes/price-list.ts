/**
 * GET /api/identity/price-list  — the protected resource for Demo 1.
 *
 *   verified agent  ->  200 + the full "Q3 partner price list"
 *   anything else   ->  401 + a public teaser and machine-readable instructions
 *                       for how to authenticate (application/problem+json)
 *
 * In a real deployment this handler would proxy the verified request through to
 * the customer's origin:
 *
 *     if (verdict.ok) return fetch(new Request(ORIGIN + url.pathname, request));
 *
 * The lab has no origin behind it, so it serves a stand-in resource instead.
 */
import { checkIdentity } from "../lib/verify";
import { json, problem } from "../lib/http";
import { logAccess, type Env } from "../lib/log";

const FULL_LIST = {
  resource: "Q3 partner price list",
  access: "verified-agent",
  currency: "EUR",
  tiers: [
    { tier: "Referral", monthly: 0, commission: "12%" },
    { tier: "Reseller", monthly: 490, commission: "25%", min_seats: 10 },
    { tier: "Strategic", monthly: 1900, commission: "34%", min_seats: 50, mdf: true },
  ],
  valid_until: "2026-09-30",
};

const TEASER = {
  resource: "Q3 partner price list",
  access: "public",
  teaser:
    "Three partner tiers (Referral, Reseller, Strategic). Full pricing and commission rates require a verified agent.",
};

const SITE = "https://lab.eleviq.solutions";

export async function handlePriceList(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const verdict = await checkIdentity(request, env);
  const directory = new URL("/.well-known/http-message-signatures-directory", request.url).toString();
  const claimedUa = request.headers.get("X-Demo-Agent-Claim") || request.headers.get("User-Agent") || null;

  if (verdict.ok) {
    logAccess(env, ctx, {
      path: "/api/identity/price-list",
      outcome: "verified",
      status: 200,
      keyid: verdict.keyid,
      agentName: verdict.agent.name,
      agentOperator: verdict.agent.operator,
      claimedUa,
      trustTier: verdict.tier,
    });
    return json({
      ...FULL_LIST,
      verified: {
        agent: verdict.agent.name,
        operator: verdict.agent.operator,
        operator_domain: verdict.agent.domain,
        keyid: verdict.keyid,
        trust_tier: verdict.tier,
        signed_at: verdict.created,
        expires: verdict.expires,
      },
    });
  }

  logAccess(env, ctx, {
    path: "/api/identity/price-list",
    outcome: verdict.reason,
    status: 401,
    keyid: verdict.keyid,
    claimedUa,
  });

  return problem(
    401,
    {
      type: `${SITE}/identity/#${verdict.reason}`,
      title: "Verified agent identity required",
      detail: verdict.detail,
      reason: verdict.reason,
      ...(verdict.keyid ? { keyid: verdict.keyid } : {}),
      teaser: TEASER,
      how_to_authenticate: {
        scheme: "Web Bot Auth — RFC 9421 HTTP Message Signatures, Ed25519",
        steps: [
          "Sign the request with your Ed25519 key (Signature / Signature-Input / Signature-Agent headers).",
          "Publish your public key at /.well-known/http-message-signatures-directory on the origin named in Signature-Agent.",
          `For this demo, a throwaway key that is already trusted is at ${SITE}/reference/demo-agent.jwk.json, and a signing script at ${SITE}/reference/sign-request.mjs`,
        ],
        directory,
        reference_script: `${SITE}/reference/sign-request.mjs`,
        demo_key: `${SITE}/reference/demo-agent.jwk.json`,
        test_helper: new URL("/api/sign", request.url).toString(),
      },
    },
    { "www-authenticate": 'Signature realm="eleviq-lab", scheme="web-bot-auth"' },
  );
}
