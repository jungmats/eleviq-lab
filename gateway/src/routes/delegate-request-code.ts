/**
 * POST /api/delegate/request-code — issues a one-time delegation code for a
 * claimed email. Requires the same signed identity as every other protected
 * endpoint here — an unverified agent doesn't get this far either.
 *
 * SIMULATED: returns the code directly instead of emailing it. See
 * lib/delegation.ts for why, and what a real deployment would do instead.
 */
import { checkIdentity } from "../lib/verify";
import { json, problem } from "../lib/http";
import { requestCode } from "../lib/delegation";
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

  const code = await requestCode(env, actingFor);

  return json({
    _warning: "DEMO — a real deployment would email this code, never return it here.",
    acting_for: actingFor,
    code,
    expires_in_seconds: 300,
    next: "Present this code via X-Delegation-Code (with X-Acting-For: same email) when requesting GET /api/delegate/account.",
  });
}
