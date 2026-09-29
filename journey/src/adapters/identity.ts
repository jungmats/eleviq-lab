/**
 * Identity adapter: turns a request into the engine's `Caller`.
 *
 * Lab implementation: Web Bot Auth, reusing the gateway's verifier (its own
 * demo keys plus the chatgpt.com registry tier). A customer deployment swaps
 * this file for API keys, mTLS, or their own agent registry — the engine only
 * ever sees `Caller`.
 *
 *   no signature headers   -> unsigned caller (fine under identity: optional)
 *   valid signature        -> caller bound to that key
 *   signature that fails   -> refused, never silently downgraded to unsigned
 */
import { checkIdentity } from "../../../gateway/src/lib/verify";
import type { Caller } from "../engine/types";
import type { Env } from "../env";

export type Identified =
  | { ok: true; caller: Caller }
  | { ok: false; reason: string; detail: string; keyid: string | null };

export const UNSIGNED: Caller = { keyid: null, agentName: null, trustTier: null };

export async function identify(request: Request, env: Env): Promise<Identified> {
  if (!request.headers.get("Signature") && !request.headers.get("Signature-Input")) {
    return { ok: true, caller: UNSIGNED };
  }
  const v = await checkIdentity(request, env);
  if (v.ok) return { ok: true, caller: { keyid: v.keyid, agentName: v.agent.name, trustTier: v.tier } };
  return { ok: false, reason: v.reason, detail: v.detail, keyid: v.keyid ?? null };
}
