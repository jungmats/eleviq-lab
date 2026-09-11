/**
 * GET /api/debug/cf — diagnostic: what Cloudflare's edge attaches to a
 * request BEFORE any Web Bot Auth signature is checked or your code runs.
 * This is the "heuristic tier" from identity/index.html — IP range /
 * reverse-DNS / User-Agent based, NOT cryptographic. Not used for any trust
 * decision; exists so you can see exactly what it looks like.
 *
 * Safe to expose: it only describes the requester's own connection (the same
 * idea as an "what's my IP" service) — nothing about the gateway itself.
 *
 * request.cf is only populated with REAL values by Cloudflare's actual edge —
 * `wrangler dev` fakes it locally, so test this against the deployed URL.
 */
import { json } from "../lib/http";

export function handleDebugCf(request: Request): Response {
  const cf = request.cf ?? null;
  const headers: Record<string, string> = {};
  for (const [key, value] of request.headers) headers[key] = value;

  return json({
    note:
      "Cloudflare edge signals for THIS request, attached before it reached this Worker. " +
      "Heuristic (IP range / reverse-DNS / User-Agent), not cryptographic — never used to allow or deny here.",
    verifiedBotCategory: cf?.verifiedBotCategory ?? null,
    botManagement: cf?.botManagement ?? null,
    clientTrustScore: cf?.clientTrustScore ?? null,
    asn: cf?.asn ?? null,
    asOrganization: cf?.asOrganization ?? null,
    country: cf?.country ?? null,
    colo: cf?.colo ?? null,
    tlsVersion: cf?.tlsVersion ?? null,
    httpProtocol: cf?.httpProtocol ?? null,
    request_headers: headers,
  });
}
