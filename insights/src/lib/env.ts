export interface Env {
  /** The same D1 database site-logger writes to (eleviq-site-log) — read-only from here. */
  DB: D1Database;
  /** Static assets (public/) — bound via wrangler.toml's [assets]; index.ts only
   *  handles /api/*, everything else is served directly from this binding. */
  ASSETS: Fetcher;
}
