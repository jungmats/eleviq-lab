/**
 * The lab's key registry.
 *
 * Every key here is a committed DEMO key (see keys/ and scripts/gen-keys.mjs) —
 * throwaway, published on purpose. The three operator entries are lab stand-ins
 * labelled with real operator names; they are NOT the operators' real keys.
 *
 * In a real deployment the private halves would live in Cloudflare secrets and
 * only the public halves would appear in the directory.
 */
import { verifierFromJWK } from "web-bot-auth/crypto";
import type { WebBotVerifier } from "web-bot-auth";

import openai from "../../keys/openai.jwk.json";
import anthropic from "../../keys/anthropic.jwk.json";
import perplexity from "../../keys/perplexity.jwk.json";
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
  { jwk: asJwk(openai),     meta: { name: "ChatGPT-User",          operator: "OpenAI",     domain: "openai.com" } },
  { jwk: asJwk(anthropic),  meta: { name: "ClaudeBot",             operator: "Anthropic",  domain: "anthropic.com" } },
  { jwk: asJwk(perplexity), meta: { name: "PerplexityBot",         operator: "Perplexity", domain: "perplexity.ai" } },
  { jwk: asJwk(demoAgent),  meta: { name: "ElevIQ Lab demo agent", operator: "ElevIQ",     domain: "eleviq.solutions" } },
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
