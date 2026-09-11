/** The gateway Worker's bindings — see gateway/wrangler.toml. */
export interface Env {
  DB: D1Database;
  NONCES: KVNamespace;
}
