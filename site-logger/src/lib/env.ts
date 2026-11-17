export interface Env {
  DB: D1Database;
  /** Secret (wrangler secret put). Requests carrying it in X-ElevIQ-Internal are logged internal = 1 (INT-2). One per client site. */
  ELEVIQ_INTERNAL_TOKEN?: string;
  /** "true" only on eleviq.solutions: accept ElevIQ's demo signing key, whose private half is published (LOG-8). */
  ACCEPT_DEMO_SIGNATURES?: string;
}
