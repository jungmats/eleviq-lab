/**
 * POST /api/sign  — DEMO TEST AID, not part of the security model.
 *
 * Holds a demo key and signs a request on your behalf, so you can exercise the
 * verified path with nothing but curl. A real agent signs with its OWN key,
 * client-side (see /reference/sign-request.mjs).
 *
 *   { "url": "https://.../api/identity/price-list", "scenario": "valid" | "unknown-key" | "expired" }
 */
import { sign, generateNonce } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { json, problem } from "../lib/http";

import demoAgent from "../../keys/demo-agent.jwk.json";
import untrusted from "../../keys/untrusted-agent.jwk.json";

type Scenario = "valid" | "unknown-key" | "expired";

export async function handleSign(request: Request): Promise<Response> {
  let body: { url?: string; scenario?: string };
  try {
    body = await request.json();
  } catch {
    return problem(400, { title: "Invalid JSON body", detail: 'Send {"url": "https://…/api/identity/price-list"}.' });
  }

  const target = String(body.url ?? "");
  const scenario = (["valid", "unknown-key", "expired"].includes(body.scenario ?? "")
    ? body.scenario
    : "valid") as Scenario;

  let origin: string;
  try {
    origin = new URL(target).origin;
  } catch {
    return problem(400, { title: "Missing or invalid 'url'", detail: "Pass the absolute URL you want to call." });
  }

  const jwk = scenario === "unknown-key" ? untrusted : demoAgent;
  const now = new Date();
  const expires = new Date(now.getTime() + (scenario === "expired" ? -60_000 : 5 * 60_000));
  const signatureAgent = `sig1="${origin}";type=directory`;

  const fields = await sign(
    new Request(target, { headers: { "Signature-Agent": signatureAgent } }),
    {
      signer: await signerFromJWK(jwk as unknown as JsonWebKey),
      created: now,
      expires,
      nonce: generateNonce(),
      target: "@target-uri",
      label: "sig1",
    },
  );

  return json({
    _warning:
      "DEMO TEST AID — this endpoint holds a demo key and signs for you. NOT how Web Bot Auth works in production; a real agent signs with its own key client-side.",
    scenario,
    method: "GET",
    url: target,
    headers: {
      "Signature-Input": fields.signatureInput,
      Signature: fields.signature,
      "Signature-Agent": signatureAgent,
    },
    replay: `curl -i '${target}' \\\n  -H 'Signature-Input: ${fields.signatureInput}' \\\n  -H 'Signature: ${fields.signature}' \\\n  -H 'Signature-Agent: ${signatureAgent}'`,
  });
}
