/**
 * Classify a visitor from its User-Agent (crawler/agent vs. human) and, if
 * present, whether its Referer names an AI assistant's chat UI (a citation
 * click, not a crawl). Both are string-matching heuristics — the same kind
 * of signal request.cf.verifiedBotCategory is, not a cryptographic proof
 * (see the lab's identity/index.html for that distinction). Good enough for
 * "how much of our traffic is which agent," not for any access decision.
 */

interface AgentSignature {
  pattern: string; // matched case-insensitively as a substring of the User-Agent
  name: string;
  operator: string;
}

// Ordered by how likely a UA is to contain the pattern; first match wins.
// Sourced from Cloudflare's AI Crawl Control bot reference (developers.cloudflare.com/ai-crawl-control/reference/bots/).
const AGENT_SIGNATURES: AgentSignature[] = [
  { pattern: "GPTBot", name: "GPTBot", operator: "OpenAI" },
  { pattern: "ChatGPT-User", name: "ChatGPT-User", operator: "OpenAI" },
  { pattern: "OAI-SearchBot", name: "OAI-SearchBot", operator: "OpenAI" },
  { pattern: "ClaudeBot", name: "ClaudeBot", operator: "Anthropic" },
  { pattern: "Claude-SearchBot", name: "Claude-SearchBot", operator: "Anthropic" },
  { pattern: "Claude-User", name: "Claude-User", operator: "Anthropic" },
  { pattern: "PerplexityBot", name: "PerplexityBot", operator: "Perplexity" },
  { pattern: "Perplexity-User", name: "Perplexity-User", operator: "Perplexity" },
  { pattern: "Google-Extended", name: "Google-Extended", operator: "Google" },
  { pattern: "Googlebot", name: "Googlebot", operator: "Google" },
  { pattern: "bingbot", name: "Bingbot", operator: "Microsoft" },
  { pattern: "meta-externalagent", name: "meta-externalagent", operator: "Meta" },
  { pattern: "facebookexternalhit", name: "facebookexternalhit", operator: "Meta" },
  { pattern: "DuckDuckBot", name: "DuckDuckBot", operator: "DuckDuckGo" },
  { pattern: "Bytespider", name: "Bytespider", operator: "ByteDance" },
  { pattern: "Applebot", name: "Applebot", operator: "Apple" },
  { pattern: "Amazonbot", name: "Amazonbot", operator: "Amazon" },
  { pattern: "CCBot", name: "CCBot", operator: "Common Crawl" },
  { pattern: "MistralAI-User", name: "MistralAI-User", operator: "Mistral" },
];

/** Returns the matched agent's name (e.g. "GPTBot"), or "human" if none match. */
export function classifyVisitor(userAgent: string | null): string {
  if (!userAgent) return "human";
  const ua = userAgent.toLowerCase();
  for (const sig of AGENT_SIGNATURES) {
    if (ua.includes(sig.pattern.toLowerCase())) return sig.name;
  }
  return "human";
}

// AI assistant chat UIs — a Referer from one of these means a human clicked
// a citation/link the assistant showed them, not that the assistant fetched
// the page itself.
const REFERRER_HOSTS: Record<string, string> = {
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
  "perplexity.ai": "Perplexity",
  "www.perplexity.ai": "Perplexity",
  "claude.ai": "Claude",
  "copilot.microsoft.com": "Copilot",
  "gemini.google.com": "Gemini",
  "you.com": "You.com",
};

/** Returns the assistant name if the Referer is a known AI chat UI, else null. */
export function classifyReferrer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return REFERRER_HOSTS[host] ?? null;
  } catch {
    return null;
  }
}
