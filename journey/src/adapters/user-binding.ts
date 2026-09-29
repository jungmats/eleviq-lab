/**
 * User-binding adapter: proves the agent acts for a specific person.
 *
 * Lab implementation: the Delegate demo's one-time code (reused code, this
 * Worker's own KV). Codes are scoped to one journey, so a code issued for one
 * journey cannot complete another. A customer deployment swaps this file for
 * their own login or OAuth.
 */
import { checkDelegation, requestCode } from "../../../gateway/src/lib/delegation";
import type { Env } from "../env";

const scoped = (journeyId: string, email: string) => `${journeyId}|${email.trim().toLowerCase()}`;

export async function issueCode(env: Env, journeyId: string, email: string): Promise<string> {
  return requestCode(env, scoped(journeyId, email));
}

export type BindingResult = { ok: true } | { ok: false; outcome: string; detail: string };

export async function checkCode(env: Env, journeyId: string, email: string, code: string): Promise<BindingResult> {
  const r = await checkDelegation(env, scoped(journeyId, email), code);
  if (r.outcome === "granted") return { ok: true };
  const detail = {
    "no-code": "No code presented.",
    "invalid-code": "That code does not match a live code for this email on this journey. Codes expire after 5 minutes.",
    "already-used": "That code was already used. Request a new one.",
  }[r.outcome];
  return { ok: false, outcome: r.outcome, detail };
}
