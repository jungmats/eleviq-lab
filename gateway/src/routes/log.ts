/**
 * GET /api/log — Demo 4 (Measure), Part A: the agent access dashboard's data
 * source. Reads gateway/schema.sql's access_log table (written by
 * price-list.ts on every request to the protected resource).
 *
 * Public, unlisted — no PII in this data (agent identity claims and
 * verification outcomes from a public demo API). Capped to the last 100
 * rows so this can't be used to dump unbounded history.
 *
 * A real customer deployment would put a path like this behind Cloudflare
 * Access (identity-aware edge auth) rather than application code — see
 * identity/index.html §3 and PLAN.md. Left open here: nothing sensitive in
 * it, and "unlisted, not access-controlled" is this lab's posture throughout.
 */
import { json } from "../lib/http";
import type { Env } from "../lib/env";

const ROW_LIMIT = 100;

interface TotalsRow {
  outcome: string;
  trust_tier: string | null;
  n: number;
}
interface DailyRow {
  day: string;
  bucket: "own" | "registry" | "unsigned" | "other_refused";
  n: number;
}
interface EntryRow {
  ts: string;
  path: string;
  outcome: string;
  status: number;
  keyid: string | null;
  agent_name: string | null;
  agent_operator: string | null;
  claimed_ua: string | null;
  trust_tier: string | null;
}

export async function handleLog(env: Env): Promise<Response> {
  const [totals, daily, recent] = await Promise.all([
    env.DB.prepare(
      `SELECT outcome, trust_tier, COUNT(*) as n FROM access_log GROUP BY outcome, trust_tier`,
    ).all<TotalsRow>(),
    env.DB.prepare(
      `SELECT substr(ts, 1, 10) as day,
              CASE
                WHEN outcome = 'verified' AND trust_tier = 'own' THEN 'own'
                WHEN outcome = 'verified' AND trust_tier LIKE 'registry:%' THEN 'registry'
                WHEN outcome = 'unsigned' THEN 'unsigned'
                ELSE 'other_refused'
              END as bucket,
              COUNT(*) as n
       FROM access_log
       GROUP BY day, bucket
       ORDER BY day ASC`,
    ).all<DailyRow>(),
    env.DB.prepare(
      `SELECT ts, path, outcome, status, keyid, agent_name, agent_operator, claimed_ua, trust_tier
       FROM access_log ORDER BY ts DESC LIMIT ?`,
    )
      .bind(ROW_LIMIT)
      .all<EntryRow>(),
  ]);

  let total = 0;
  let verified = 0;
  let refused = 0;
  const byTier: Record<string, number> = {};
  for (const row of totals.results ?? []) {
    total += row.n;
    if (row.outcome === "verified") {
      verified += row.n;
      const tier = row.trust_tier ?? "own";
      byTier[tier] = (byTier[tier] ?? 0) + row.n;
    } else {
      refused += row.n;
    }
  }

  return json({
    summary: { total, verified, refused, by_tier: byTier },
    daily: daily.results ?? [],
    entries: recent.results ?? [],
    row_limit: ROW_LIMIT,
  });
}
