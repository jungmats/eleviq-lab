/**
 * Demo 2 — Decide: the policy for the one protected resource this demo gates.
 *
 * POLICY is the single hand-authored fact. Both the "stated" artifact (the
 * RSL license at /.well-known/rsl.xml) AND the "enforced" decision (decide(),
 * used by /api/decide/deal-notes) derive from it — so declaring and enforcing
 * can never drift apart by construction. decide() goes one step further: it
 * parses the exact XML this gateway serves, rather than reading POLICY
 * directly, so the enforcement decision is provably reading the same
 * document a fetcher would receive, not a hand-synced shadow copy.
 *
 * robots.txt Content Signals were considered and deliberately left out: they
 * can only state a policy for an entire site, never for one resource, so they
 * had no real part to play in a demo about whether THIS resource allows THIS
 * use — RSL's <content url="..."> can target exactly that, and does.
 *
 * The teaching point of this demo is not that stated and enforced disagree —
 * it's that publishing a policy protects nothing by itself. Only enforcement
 * does. See docs/decide/index.html §1/§3.
 */
import { buildRslXml, parseRslXml, type UsagePolicy, type UsageType } from "./rsl";

export const ALL_USAGE_TYPES: UsageType[] = ["search", "ai-input", "ai-train"];

/** Demo convention — NOT a ratified standard. Values reuse RSL's own usage
 * vocabulary, so no translation is needed between what's declared and what's
 * requested. */
export const PURPOSE_HEADER = "X-Agent-Purpose";

const RESOURCE_PATH = "/api/decide/deal-notes";

/** The one authored fact. Everything else in this module derives from it. */
export const POLICY: UsagePolicy = {
  permits: ["ai-input", "search"],
  prohibits: ["ai-train"],
};

export function rslXmlFor(origin: string): string {
  return buildRslXml(POLICY, origin + RESOURCE_PATH);
}

export type PolicyDecision =
  | { decision: "allow"; purpose: UsageType }
  | { decision: "deny"; reason: "purpose-prohibited"; purpose: UsageType }
  | { decision: "deny"; reason: "purpose-undeclared"; purpose: null };

function normalizePurpose(raw: string | null): UsageType | null {
  const v = (raw ?? "").trim().toLowerCase();
  return (ALL_USAGE_TYPES as string[]).includes(v) ? (v as UsageType) : null;
}

/**
 * No purpose declared → deny. A deliberate design choice: not knowing what a
 * request intends to do with the resource is not treated as permission to
 * find out. The default is the safe one, not the permissive one.
 */
export function decide(purposeHeaderRaw: string | null, origin: string): PolicyDecision {
  const parsed = parseRslXml(rslXmlFor(origin));
  const purpose = normalizePurpose(purposeHeaderRaw);
  if (!purpose) return { decision: "deny", reason: "purpose-undeclared", purpose: null };
  if (parsed.prohibits.includes(purpose)) return { decision: "deny", reason: "purpose-prohibited", purpose };
  return { decision: "allow", purpose };
}
