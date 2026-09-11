/**
 * The lab's key registry.
 *
 * Trust here has ONE entry: "ElevIQ Lab demo agent" — a single throwaway
 * keypair (see keys/demo-agent.jwk.json + scripts/gen-keys.mjs). A signature
 * from it proves possession of that one key, nothing more. It is NOT labelled
 * as OpenAI, Anthropic or anyone else — the demo used to do that, which
 * overstated what the crypto actually proves. See identity/index.html §2 for
 * how the console's "claimed identity" dropdown is now separate from this.
 *
 * `keys/untrusted-agent.jwk.json` is deliberately NOT in this registry — it
 * exists only so the "unknown key" scenario has something valid-but-untrusted
 * to sign with.
 *
 * What makes a REAL agent's key trustworthy that this demo key isn't:
 *   1. the private half is genuinely secret — only the operator ever holds it
 *      (ours is published on purpose, so anyone can play "the demo agent");
 *   2. its directory is reachable at a domain the operator controls, AND that
 *      domain is recognised — via a vetted registry (Cloudflare Verified Bots,
 *      the IETF/Bedrock agent-directory registry) — not just "any signature
 *      that verifies". A verifier trusting every syntactically valid signature
 *      would trust anyone who bothered to generate a keypair.
 *
 * In a real deployment the private half lives in a Cloudflare secret; only the
 * public half appears in the directory.
 */
import { verifierFromJWK } from "web-bot-auth/crypto";
import type { WebBotVerifier } from "web-bot-auth";

import demoAgent from "../../keys/demo-agent.jwk.json";

export interface AgentMeta {
  /** what the agent calls itself (its User-Agent product token) */
  name: string;
  /** the organisation accountable for it */
  operator: string;
  /** the operator's domain, or null if undisclosed */
  domain: string | null;
}

type Jwk = JsonWebKey & Record<string, string>;

const asJwk = (x: unknown) => x as Jwk;

const REGISTRY: Array<{ jwk: Jwk; meta: AgentMeta }> = [
  { jwk: asJwk(demoAgent), meta: { name: "ElevIQ Lab demo agent", operator: "ElevIQ", domain: "eleviq.solutions" } },
];

/** Strip the private component — what goes in the public directory. */
function publicOnly(jwk: Jwk): Jwk {
  const { d, ...rest } = jwk;
  return rest as Jwk;
}

let store: Map<string, { verifier: WebBotVerifier; meta: AgentMeta }> | null = null;

/** keyid (JWK thumbprint) -> verifier + operator metadata, for the trusted keys. */
export async function trustStore() {
  if (store) return store;
  const next = new Map<string, { verifier: WebBotVerifier; meta: AgentMeta }>();
  for (const { jwk, meta } of REGISTRY) {
    const verifier = await verifierFromJWK(publicOnly(jwk));
    next.set(verifier.keyid, { verifier, meta });
  }
  store = next;
  return store;
}

/** The public keys, in the shape the well-known directory serves. */
export function directoryKeys(): Array<Record<string, string>> {
  return REGISTRY.map(({ jwk }) => {
    const p = publicOnly(jwk) as Record<string, string>;
    const out: Record<string, string> = { kty: p.kty, crv: p.crv, x: p.x };
    if (p.kid) out.kid = p.kid;
    return out;
  });
}
