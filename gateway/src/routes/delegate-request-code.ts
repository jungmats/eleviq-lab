/**
 * POST /api/delegate/request-code — issues a one-time delegation code for a
 * claimed email and emails it. Requires the same signed identity as every
 * other protected endpoint here — an unverified agent doesn't get this far
 * either.
 *
 * The code is never returned in this response — only the inbox that owns
 * `acting_for` ever sees it. See lib/email.ts for delivery and
 * lib/ratelimit.ts for the abuse guard this endpoint needs now that it
 * triggers a real send.
 */
import { checkIdentity } from "../lib/verify";
import { json, problem } from "../lib/http";
import { requestCode } from "../lib/delegation";
import { sendDelegationCode } from "../lib/email";
import { checkRateLimit } from "../lib/ratelimit";
import type { Env } from "../lib/env";

export async function handleRequestCode(request: Request, env: Env): Promise<Response> {
  const verdict = await checkIdentity(request, env);
  if (!verdict.ok) {
    return problem(
      401,
      { title: "Verified agent identity required", detail: verdict.detail, reason: verdict.reason },
      { "www-authenticate": 'Signature realm="eleviq-lab", scheme="web-bot-auth"' },
    );
  }

  let body: { acting_for?: string };
  try {
    body = await request.json();
  } catch {
    return problem(400, { title: "Invalid JSON body", detail: 'Send {"acting_for": "someone@example.com"}.' });
  }

  const actingFor = String(body.acting_for ?? "").trim();
  if (!actingFor || !actingFor.includes("@")) {
    return problem(400, {
      title: "Missing or invalid 'acting_for'",
      detail: "Pass the email address the agent is acting for.",
    });
  }

  const ip = request.headers.get("CF-Connecting-IP");
  const allowed = await checkRateLimit(env, actingFor, ip);
  if (!allowed) {
    return problem(429, {
      title: "Too many code requests",
      detail: "This email address (or your connection) has requested too many codes recently. Wait a bit and try again.",
    });
  }

  const code = await requestCode(env, actingFor);
  const sent = await sendDelegationCode(env, actingFor, code);
  if (!sent.ok) {
    return problem(502, { title: "Could not send the code", detail: sent.detail });
  }

  return json({
    acting_for: actingFor,
    sent: true,
    expires_in_seconds: 300,
    next: "Check that inbox, then present the code via X-Delegation-Code (with X-Acting-For: same email) when requesting GET /api/delegate/account.",
  });
}
