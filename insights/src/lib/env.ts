export interface Env {
  /** The same D1 database site-logger writes to (eleviq-site-log) — read-only from here. */
  DB: D1Database;
  /** Static assets (public/) — bound via wrangler.toml's [assets]; index.ts only
   *  handles /api/*, everything else is served directly from this binding. */
  ASSETS: Fetcher;
  /** "true" includes ElevIQ's own test traffic (internal = 1) and shows a banner (INT-4).
   *  Per deployment, consultant only; never a UI switch (INT-3). */
  SHOW_INTERNAL?: string;
}
