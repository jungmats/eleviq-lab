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
  /** Demo 3 (Delegate) only — the claimed X-Acting-For email, if any. */
  actingFor?: string | null;
  /** Demo 3 (Delegate) only — the delegation check's outcome. */
  delegationOutcome?: "granted" | "no-code" | "invalid-code" | "already-used" | null;
  /** Demo 4 (Charge) only — how the payment attempt resolved. */
  chargeStatus?:
    | "payment-required"
    | "paid"
    | "malformed-payment"
    | "signature-mismatch"
    | "amount-too-low"
    | "wrong-payee"
    | "on-chain-rejected"
    | "settlement-failed"
    | null;
  /** Demo 4 (Charge) only — the price this request was quoted, atomic USDC units. */
  chargeAmount?: string | null;
  /** Demo 4 (Charge) only — the settlement transaction hash, once paid. */
  chargeTxHash?: string | null;
}

export function logAccess(env: Env, ctx: ExecutionContext, entry: AccessLogEntry): void {
  const write = env.DB.prepare(
    `INSERT INTO access_log (ts, path, outcome, status, keyid, agent_name, agent_operator, claimed_ua, trust_tier, purpose, policy_decision, policy_reason, acting_for, delegation_outcome, charge_status, charge_amount, charge_tx_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    entry.actingFor ?? null,
    entry.delegationOutcome ?? null,
    entry.chargeStatus ?? null,
    entry.chargeAmount ?? null,
    entry.chargeTxHash ?? null,
  );

  // Never let a logging failure affect the response.
  ctx.waitUntil(write.run().catch((err) => console.error("access log write failed:", err)));
}
