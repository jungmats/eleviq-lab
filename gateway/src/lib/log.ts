/**
 * Access log — one row per request to a protected resource, verified or not.
 * Foundation for Demo 4 (Measure); see schema.sql.
 *
 * Writes via ctx.waitUntil so logging never delays or can fail the response.
 */
import type { Env } from "./env";
export type { Env };

export interface AccessLogEntry {
  path: string;
  outcome: "verified" | "unsigned" | "unknown-key" | "expired" | "invalid" | "replayed";
  status: number;
  keyid?: string;
  agentName?: string;
  agentOperator?: string;
  claimedUa?: string | null;
  /** "own" | "registry:<origin>" — which trust tier verified this, if any. */
  trustTier?: string;
  /** Demo 2 (Decide) only — the declared X-Agent-Purpose, if any. */
  purpose?: string | null;
  /** Demo 2 (Decide) only — the policy engine's decision. */
  policyDecision?: "allow" | "deny" | null;
  /** Demo 2 (Decide) only — why the policy engine denied, if it did. */
  policyReason?: "purpose-prohibited" | "purpose-undeclared" | null;
}

export function logAccess(env: Env, ctx: ExecutionContext, entry: AccessLogEntry): void {
  const write = env.DB.prepare(
    `INSERT INTO access_log (ts, path, outcome, status, keyid, agent_name, agent_operator, claimed_ua, trust_tier, purpose, policy_decision, policy_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    new Date().toISOString(),
    entry.path,
    entry.outcome,
    entry.status,
    entry.keyid ?? null,
    entry.agentName ?? null,
    entry.agentOperator ?? null,
    entry.claimedUa ?? null,
    entry.trustTier ?? null,
    entry.purpose ?? null,
    entry.policyDecision ?? null,
    entry.policyReason ?? null,
  );

  // Never let a logging failure affect the response.
  ctx.waitUntil(write.run().catch((err) => console.error("access log write failed:", err)));
}
