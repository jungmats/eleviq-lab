/**
 * Classify a visitor from its User-Agent (and Referer, separately) into a
 * name + coarse category. Heuristic string-matching — the same kind of
 * signal request.cf.verifiedBotCategory is, not a cryptographic proof (see
 * the lab's identity/index.html for that distinction).
 *
 * Categories mirror Cloudflare's own AI Crawl Control taxonomy (Search /
 * Agent / Training), plus "human" and "unrecognized":
 *   - training     bulk scraping to train models (GPTBot, CCBot, …) — not
 *                  tied to any specific person
 *   - search       indexing for search results (Googlebot, Bingbot, …)
 *   - agent        fetches the page LIVE because a specific person asked it
 *                  something right now (ChatGPT-User, Claude-User, …) —
 *                  this is genuine attribution, not background noise
 *   - human        looks like a real browser, no known agent signature
 *   - unrecognized doesn't look like a browser AND doesn't match a known
 *                  signature — likely a home-grown / unlabelled agent
 *
 * Currently logging every category (see index.ts) — deliberately not
 * filtering training/search out yet; that's a one-line change once there's
 * real data to decide from.
 */

export type VisitorCategory = "human" | "search" | "training" | "agent" | "unrecognized";

export interface Visitor {
  name: string;
  category: VisitorCategory;
}

interface AgentSignature {
  pattern: string; // matched case-insensitively as a substring of the User-Agent
  name: string;
  operator: string;
  category: "training" | "search" | "agent";
}

// Sourced from Cloudflare's AI Crawl Control bot reference
// (developers.cloudflare.com/ai-crawl-control/reference/bots/). A few
// (facebookexternalhit, Amazonbot) are best-effort category guesses —
// refine once real traffic shows how they actually behave.
const AGENT_SIGNATURES: AgentSignature[] = [
  { pattern: "ChatGPT-User", name: "ChatGPT-User", operator: "OpenAI", category: "agent" },
  { pattern: "OAI-SearchBot", name: "OAI-SearchBot", operator: "OpenAI", category: "search" },
  { pattern: "GPTBot", name: "GPTBot", operator: "OpenAI", category: "training" },
  { pattern: "Claude-User", name: "Claude-User", operator: "Anthropic", category: "agent" },
  { pattern: "Claude-SearchBot", name: "Claude-SearchBot", operator: "Anthropic", category: "search" },
  { pattern: "ClaudeBot", name: "ClaudeBot", operator: "Anthropic", category: "training" },
  { pattern: "Perplexity-User", name: "Perplexity-User", operator: "Perplexity", category: "agent" },
  { pattern: "PerplexityBot", name: "PerplexityBot", operator: "Perplexity", category: "search" },
  { pattern: "Google-Extended", name: "Google-Extended", operator: "Google", category: "training" },
  { pattern: "Googlebot", name: "Googlebot", operator: "Google", category: "search" },
  { pattern: "bingbot", name: "Bingbot", operator: "Microsoft", category: "search" },
  { pattern: "meta-externalagent", name: "meta-externalagent", operator: "Meta", category: "training" },
  { pattern: "facebookexternalhit", name: "facebookexternalhit", operator: "Meta", category: "search" },
  { pattern: "DuckDuckBot", name: "DuckDuckBot", operator: "DuckDuckGo", category: "search" },
  { pattern: "Bytespider", name: "Bytespider", operator: "ByteDance", category: "training" },
  { pattern: "Applebot", name: "Applebot", operator: "Apple", category: "search" },
  { pattern: "Amazonbot", name: "Amazonbot", operator: "Amazon", category: "training" },
  { pattern: "CCBot", name: "CCBot", operator: "Common Crawl", category: "training" },
  { pattern: "MistralAI-User", name: "MistralAI-User", operator: "Mistral", category: "agent" },
];

// A real browser's UA reliably contains "Mozilla/5.0" plus at least one of
// these engine/browser tokens. Anything that doesn't is very unlikely to be
// a human with a normal browser — most home-grown agents land here (an HTTP
// library's default UA, e.g. "python-requests/2.x", "curl/8.x",
// "node-fetch", "axios/1.x", "Go-http-client", "okhttp/4.x") without ever
// needing to be named individually.
const BROWSER_TOKENS = ["AppleWebKit", "Gecko", "Chrome", "Safari", "Firefox", "Edg/", "OPR/"];

export function classifyVisitor(userAgent: string | null): Visitor {
  if (!userAgent) return { name: "unrecognized (no User-Agent)", category: "unrecognized" };

  for (const sig of AGENT_SIGNATURES) {
    if (userAgent.toLowerCase().includes(sig.pattern.toLowerCase())) {
      return { name: sig.name, category: sig.category };
    }
  }

  const looksLikeBrowser = userAgent.includes("Mozilla/5.0") && BROWSER_TOKENS.some((t) => userAgent.includes(t));
  if (looksLikeBrowser) return { name: "human", category: "human" };

  return { name: "unrecognized agent", category: "unrecognized" };
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
