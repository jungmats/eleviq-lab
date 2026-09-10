/**
 * Web Bot Auth verification for the demo — wraps web-bot-auth's verify() and
 * turns the outcome into a small, typed verdict the endpoint and the page can
 * render.
 */
import { verify } from "web-bot-auth";
import { trustStore, type AgentMeta } from "./keys";

export type Verdict =
  | {
      ok: true;
      keyid: string;
      agent: AgentMeta;
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

  try {
    const result = await verify(request, {
      maxAge: 600,
      clockSkew: 60,
      resolver: (candidate) => {
        attemptedKeyid = candidate.keyid;
        const entry = store.get(candidate.keyid);
        if (!entry) throw new Error("key not in trusted directory");
        return entry.verifier;
      },
    });

    const entry = store.get(result.keyid);
    if (!entry) {
      return { ok: false, reason: "unknown-key", keyid: result.keyid, detail: "key not in trusted directory" };
    }
    return {
      ok: true,
      keyid: result.keyid,
      agent: entry.meta,
      created: result.created.toISOString(),
      expires: result.expires.toISOString(),
    };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);

    // The resolver rejected the key (it isn't in our directory).
    if (attemptedKeyid && !store.has(attemptedKeyid)) {
      return {
        ok: false,
        reason: "unknown-key",
        keyid: attemptedKeyid,
        detail: `Signature is cryptographically well-formed, but key ${attemptedKeyid} is not listed in any directory this server trusts.`,
      };
    }
    if (/expire|created|stale|age|clock/i.test(msg)) {
      return { ok: false, reason: "expired", keyid: attemptedKeyid, detail: `Signature is outside its validity window: ${msg}` };
    }
    return { ok: false, reason: "invalid", keyid: attemptedKeyid, detail: `Signature did not verify: ${msg}` };
  }
}
