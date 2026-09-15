/** The gateway Worker's bindings — see gateway/wrangler.toml. */
export interface Env {
  DB: D1Database;
  NONCES: KVNamespace;
  DELEGATION_CODES: KVNamespace;
  /** Resend API key — a secret, not in wrangler.toml. `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY: string;
  /** Demo 4 (Charge) relayer/payTo private key (Base Sepolia) — a secret, not
   * in wrangler.toml. `wrangler secret put CHARGE_RELAYER_KEY`. See
   * scripts/gen-charge-keys.mjs and src/lib/x402.ts. */
  CHARGE_RELAYER_KEY: string;
}
