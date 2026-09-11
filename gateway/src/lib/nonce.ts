/**
 * Nonce replay protection. Every Web Bot Auth signature carries a fresh
 * random nonce; a captured-but-still-valid signature can otherwise be
 * replayed for as long as it stays within its own expires window (this is
 * exactly how a real captured signature was replayed against this gateway
 * during development — see PLAN.md).
 *
 * Call ONLY after verify() has already confirmed the signature is
 * cryptographically valid and from a trusted key. This never gates on its
 * own — it only rejects a genuine signature being reused.
 */
import type { Env } from "./env";

/**
 * Returns true (and records the nonce) the first time it's seen; false if
 * it's already been used. `ttlSeconds` should be how long until the
 * signature's own `expires` — no point remembering it any longer than that,
 * since it would fail the expiry check anyway.
 */
export async function claimNonce(env: Env, nonce: string, ttlSeconds: number): Promise<boolean> {
  const existing = await env.NONCES.get(nonce);
  if (existing) return false;

  // KV's minimum TTL is 60s; a signature expiring sooner than that still
  // gets a minimum safe window rather than an invalid/zero TTL.
  await env.NONCES.put(nonce, "1", { expirationTtl: Math.max(60, Math.ceil(ttlSeconds)) });
  return true;
}
