/**
 * Demo 3 — Delegate: proving an agent is acting for a specific person.
 *
 * A verified agent (Demo 1) allowed to do this (Demo 2) still isn't the same
 * as the person it claims to represent — nothing stops it from just naming
 * an email. The proof here: a one-time code tied to that email, single-use,
 * short-lived, stored in KV (same shape as nonce.ts's replay protection).
 *
 * SIMULATED for now: requestCode() returns the code directly in the API
 * response instead of emailing it — clearly labeled as a demo stand-in
 * wherever it's used (see routes/delegate-request-code.ts). A real
 * deployment would email it and never return it. Swapping that in later
 * doesn't change this module's shape, only what the route does with the code
 * after generating it.
 */
import type { Env } from "./env";

const CODE_TTL_SECONDS = 5 * 60;

function generateCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

function kvKey(actingFor: string, code: string): string {
  return `${actingFor.trim().toLowerCase()}:${code}`;
}

/** Generates and stores a fresh code for this email. Returns the code. */
export async function requestCode(env: Env, actingFor: string): Promise<string> {
  const code = generateCode();
  await env.DELEGATION_CODES.put(kvKey(actingFor, code), "pending", { expirationTtl: CODE_TTL_SECONDS });
  return code;
}

export type DelegationOutcome =
  | { outcome: "granted"; actingFor: string }
  | { outcome: "no-code"; actingFor: string | null }
  | { outcome: "invalid-code"; actingFor: string };

/**
 * Checks a claimed (email, code) pair. Single-use: a valid code is consumed
 * on success, same as Demo 1's nonce — presenting it again fails.
 */
export async function checkDelegation(
  env: Env,
  actingFor: string | null,
  code: string | null,
): Promise<DelegationOutcome> {
  if (!actingFor || !code) return { outcome: "no-code", actingFor };

  const key = kvKey(actingFor, code);
  const existing = await env.DELEGATION_CODES.get(key);
  if (!existing) return { outcome: "invalid-code", actingFor };

  await env.DELEGATION_CODES.delete(key);
  return { outcome: "granted", actingFor };
}
