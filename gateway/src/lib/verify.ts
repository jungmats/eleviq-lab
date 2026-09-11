/**
 * Web Bot Auth verification for the demo — wraps web-bot-auth's verify() and
 * turns the outcome into a small, typed verdict the endpoint and the page can
 * render.
 *
 * Two trust tiers, checked in order, per request:
 *   1. Own key  — our committed demo key, checked locally, no network call.
 *   2. Registry — the Signature-Agent's origin is on our own hardcoded
 *      allow-list (registry.ts); if so, fetch THAT operator's OWN directory
 *      live (cached) and check the key against what it currently publishes.
 * Neither check ever fetches a URL taken from the request — the registry
 * lookup only ever dereferences an origin already in our fixed allow-list.
 */
import { verify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { trustStore, type AgentMeta } from "./keys";
import { findRegistryEntry } from "./registry";
import { fetchOperatorKey } from "./external-directory";

export type TrustTier = "own" | `registry:${string}`;

export type Verdict =
  | {
      ok: true;
      keyid: string;
      agent: AgentMeta;
      tier: TrustTier;
      created: string;
      expires: string;
    }
  | {
      ok: false;
      reason: "unsigned" | "unknown-key" | "expired" | "invalid";
      detail: string;
      keyid?: string;
    };

export async function checkIdentity(request: Request): Promise<Verdict> {
  const hasSig = request.headers.get("Signature");
  const hasInput = request.headers.get("Signature-Input");
  if (!hasSig || !hasInput) {
    return {
      ok: false,
      reason: "unsigned",
      detail:
        "No Signature / Signature-Input header. The request carries only a User-Agent claim, which is not proof of identity.",
    };
  }

  const store = await trustStore();
  let attemptedKeyid: string | undefined;
  let matchedTier: TrustTier | undefined;
  let matchedAgent: AgentMeta | undefined;

  try {
    const result = await verify(request, {
      // How old `created` may be — a ceiling WE enforce, independent of the
      // signature's own `expires`. Our own demo signer uses a 5 min window;
      // observed real-world operators (OpenAI's chatgpt.com) use up to 1
      // hour. Set to match that rather than reject legitimate Tier 2 traffic.
      maxAge: 3600,
      clockSkew: 60,
      resolver: async (candidate) => {
        attemptedKeyid = candidate.keyid;

        // Tier 1: our own key — no network call.
        const own = store.get(candidate.keyid);
        if (own) {
          matchedTier = "own";
          matchedAgent = own.meta;
          return own.verifier;
        }

        // Tier 2: is the CLAIMED directory an operator we've allow-listed?
        // (Exact match against our fixed list — never against the request.)
        const sigAgentUri = candidate.signatureAgent?.uri;
        const entry = sigAgentUri ? findRegistryEntry(sigAgentUri) : undefined;
        if (!entry) throw new Error("key not in trusted directory");

        const jwk = await fetchOperatorKey(entry.origin, candidate.keyid);
        if (!jwk) throw new Error("key not found in operator's own directory");

        matchedTier = `registry:${entry.origin}`;
        matchedAgent = { name: entry.label, operator: entry.operator, domain: new URL(entry.origin).hostname };
        return verifierFromJWK(jwk);
      },
    });

    if (!matchedTier || !matchedAgent) {
      // Shouldn't happen — verify() only resolves with a verifier the resolver returned.
      return { ok: false, reason: "invalid", keyid: result.keyid, detail: "internal: no matched tier" };
    }
    return {
      ok: true,
      keyid: result.keyid,
      agent: matchedAgent,
      tier: matchedTier,
      created: result.created.toISOString(),
      expires: result.expires.toISOString(),
    };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);

    if (!matchedTier) {
      return {
        ok: false,
        reason: "unknown-key",
        keyid: attemptedKeyid,
        detail: attemptedKeyid
          ? `Signature is cryptographically well-formed, but key ${attemptedKeyid} is not our own key, and its claimed directory is either not on our registry allow-list or does not currently publish that key.`
          : "No usable Signature-Input.",
      };
    }
    if (/expire|created|stale|age|clock/i.test(msg)) {
      return { ok: false, reason: "expired", keyid: attemptedKeyid, detail: `Signature is outside its validity window: ${msg}` };
    }
    return { ok: false, reason: "invalid", keyid: attemptedKeyid, detail: `Signature did not verify: ${msg}` };
  }
}
