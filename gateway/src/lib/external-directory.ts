/**
 * Fetches (and caches) a Tier-2 operator's OWN key directory, live — never a
 * static copy. Only ever called with an `origin` that came from our fixed
 * REGISTRY allow-list (see registry.ts), never from anything in the request,
 * so this cannot be used to make the gateway fetch an attacker-chosen URL.
 *
 * Caching is a plain in-memory module-scope map rather than the Workers
 * Cache API: caches.default is unreliable on *.workers.dev (no zone), and a
 * per-isolate cache is fine here — worst case is an occasional extra fetch
 * when a new isolate spins up, never a correctness problem.
 */
import { verifierFromJWK } from "web-bot-auth/crypto";

const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 20_000;

interface DirectoryCacheEntry {
  fetchedAt: number;
  keys: Array<Record<string, unknown>>;
}

const cache = new Map<string, DirectoryCacheEntry>();

async function fetchDirectory(origin: string): Promise<Array<Record<string, unknown>>> {
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.keys;

  const url = origin + DIRECTORY_PATH;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return cached?.keys ?? []; // network failure: fall back to stale cache if any, else nothing
  }
  if (!res.ok) return cached?.keys ?? [];

  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) return cached?.keys ?? [];

  let body: { keys?: Array<Record<string, unknown>> };
  try {
    body = JSON.parse(text);
  } catch {
    return cached?.keys ?? [];
  }
  const keys = Array.isArray(body.keys) ? body.keys : [];
  cache.set(origin, { fetchedAt: Date.now(), keys });
  return keys;
}

/**
 * Returns the JWK for `keyid` from `origin`'s live directory, or null if it
 * isn't there, is outside its own nbf/exp validity window, or the fetch
 * failed. Matches by RECOMPUTED thumbprint (not a raw `kid` field, which an
 * operator could set to anything) — same rule the local Tier-1 store uses.
 */
export async function fetchOperatorKey(origin: string, keyid: string): Promise<JsonWebKey | null> {
  const keys = await fetchDirectory(origin);
  const now = Math.floor(Date.now() / 1000);

  for (const jwk of keys) {
    if (typeof jwk.nbf === "number" && now < jwk.nbf) continue;
    if (typeof jwk.exp === "number" && now > jwk.exp) continue;
    try {
      const verifier = await verifierFromJWK(jwk as unknown as JsonWebKey);
      if (verifier.keyid === keyid) return jwk as unknown as JsonWebKey;
    } catch {
      continue; // not a usable key (wrong kty/crv, malformed) — skip it
    }
  }
  return null;
}
