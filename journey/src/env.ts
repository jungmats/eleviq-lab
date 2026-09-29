/** The journey Worker's bindings — see journey/wrangler.toml. */
export interface Env {
  DB: D1Database;
  NONCES: KVNamespace;
  DELEGATION_CODES: KVNamespace;
  ASSETS: Fetcher;
  /** Optional: sent as a bearer token by the webhook sink. */
  JOURNEY_WEBHOOK_SECRET?: string;
}
