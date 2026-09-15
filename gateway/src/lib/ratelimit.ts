/**
 * Coarse abuse guard for POST /api/delegate/request-code — a public endpoint
 * that (now) triggers a real email send, so it needs a cap independent of
 * the delegation codes' own single-use/TTL logic. Reuses the
 * DELEGATION_CODES KV namespace under a "ratelimit:" prefix rather than
 * adding a new binding.
 *
 * Not atomic (KV has no increment) — a lab-scale guard against accidental
 * loops and casual abuse, not a precise limiter. Worst case of the
 * read-then-write race is a couple of extra emails, not an unbounded flood.
 */
import type { Env } from "./env";

interface Window {
  count: number;
  resetAt: number;
}

async function hit(env: Env, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = Date.now();
  const raw = await env.DELEGATION_CODES.get(key);
  let w: Window = raw ? JSON.parse(raw) : { count: 0, resetAt: now + windowSeconds * 1000 };
  if (now > w.resetAt) w = { count: 0, resetAt: now + windowSeconds * 1000 };
  w.count += 1;
  await env.DELEGATION_CODES.put(key, JSON.stringify(w), {
    expirationTtl: Math.max(60, Math.ceil((w.resetAt - now) / 1000)),
  });
  return w.count <= limit;
}

/** true = allowed, false = over the limit (either cap). */
export async function checkRateLimit(env: Env, actingFor: string, ip: string | null): Promise<boolean> {
  const perEmail = await hit(env, `ratelimit:email:${actingFor.trim().toLowerCase()}`, 3, 15 * 60);
  const perIp = ip ? await hit(env, `ratelimit:ip:${ip}`, 10, 60 * 60) : true;
  return perEmail && perIp;
}
