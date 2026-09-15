/** The gateway Worker's bindings — see gateway/wrangler.toml. */
export interface Env {
  DB: D1Database;
  NONCES: KVNamespace;
  DELEGATION_CODES: KVNamespace;
  /** Resend API key — a secret, not in wrangler.toml. `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY: string;
}
