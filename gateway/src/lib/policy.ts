/**
 * Demo 2 — Decide: the policy for the one protected resource this demo gates.
 *
 * POLICY is the single hand-authored fact. Both "stated" artifacts (the
 * Content-Signal line in /robots.txt and the RSL license at
 * /.well-known/rsl.xml) AND the "enforced" decision (decide(), used by
 * /api/decide/deal-notes) derive from it — so declaring and enforcing can
 * never drift apart by construction. decide() goes one step further: it
 * parses the exact XML this gateway serves, rather than reading POLICY
 * directly, so the enforcement decision is provably reading the same
 * document a fetcher would receive, not a hand-synced shadow copy.
 *
 * The teaching point of this demo is not that stated and enforced disagree —
 * it's that publishing a policy protects nothing by itself. Only enforcement
 * does. See docs/decide/index.html §1/§3.
 */
import { buildRslXml, parseRslXml, type UsagePolicy, type UsageType } from "./rsl";

export const ALL_USAGE_TYPES: UsageType[] = ["search", "ai-input", "ai-train"];

/** Demo convention — NOT a ratified standard. Values reuse the exact vocabulary
 * Content Signals and RSL both already define, so no translation is needed. */
export const PURPOSE_HEADER = "X-Agent-Purpose";

const RESOURCE_PATH = "/api/decide/deal-notes";
const LICENSE_PATH = "/.well-known/rsl.xml";

/** The one authored fact. Everything else in this module derives from it. */
export const POLICY: UsagePolicy = {
  permits: ["ai-input", "search"],
  prohibits: ["ai-train"],
};

export function rslXmlFor(origin: string): string {
  return buildRslXml(POLICY, origin + RESOURCE_PATH);
}

/**
 * The real Content Signals Policy boilerplate (contentsignals.org, Cloudflare,
 * CC0-licensed) — verbatim, not our own paraphrase, so this fixture reads
 * exactly like a real site's robots.txt rather than an approximation of one.
 */
const CONTENT_SIGNALS_POLICY_TEXT = `# As a condition of accessing this website, you agree to abide by the following
# content signals:

# (a)  If a content-signal = yes, you may collect content for the corresponding
#      use.
# (b)  If a content-signal = no, you may not collect content for the
#      corresponding use.
# (c)  If the website operator does not include a content signal for a
#      corresponding use, the website operator neither grants nor restricts
#      permission via content signal with respect to the corresponding use.

# The content signals and their meanings are:

# search:   building a search index and providing search results (e.g., returning
#           hyperlinks and short excerpts from your website's contents). Search does not
#           include providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g., retrieval
#           augmented generation, grounding, or other real-time taking of content for
#           generative AI search answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF
# RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT
# AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.`;

export function robotsTxtFor(origin: string): string {
  const parts: string[] = [];
  for (const t of ALL_USAGE_TYPES) {
    if (POLICY.permits.includes(t)) parts.push(`${t}=yes`);
    else if (POLICY.prohibits.includes(t)) parts.push(`${t}=no`);
  }
  return (
    `# ElevIQ Lab — Demo 2 (Decide): https://lab.eleviq.solutions/decide/\n\n` +
    `${CONTENT_SIGNALS_POLICY_TEXT}\n\n` +
    `User-agent: *\n` +
    `Content-Signal: ${parts.join(", ")}\n` +
    `Allow: /\n` +
    `License: ${origin}${LICENSE_PATH}\n`
  );
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
 * Deliberate divergence from the real Content Signals spec: that spec treats
 * an undeclared signal as neutral (neither granted nor restricted). This
 * gateway's ENFORCEMENT treats "no purpose declared" as a default-most-
 * restrictive deny — stricter than the advisory declaration. That gap is
 * itself the teaching point: declaring is advisory; enforcement is a
 * separate, independent decision that can be stricter than what's stated.
 */
export function decide(purposeHeaderRaw: string | null, origin: string): PolicyDecision {
  const parsed = parseRslXml(rslXmlFor(origin));
  const purpose = normalizePurpose(purposeHeaderRaw);
  if (!purpose) return { decision: "deny", reason: "purpose-undeclared", purpose: null };
  if (parsed.prohibits.includes(purpose)) return { decision: "deny", reason: "purpose-prohibited", purpose };
  return { decision: "allow", purpose };
}
