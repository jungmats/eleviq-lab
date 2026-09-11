/**
 * Tier 2 trust — a small, hardcoded allow-list of real operator directories.
 *
 * Deliberately NOT a live fetch of Cloudflare's registry file
 * (assets.radar.cloudflare.com/bots/signature-agent-registry.txt) — that file
 * sits behind a JS challenge for non-browser fetches. Instead: curate our own
 * short list, same pattern Cloudflare's own reference tooling (Caddy's
 * httpsig middleware) uses.
 *
 * Confirmed live 2026-09-11: chatgpt.com publishes a real directory, and a
 * genuine Web Bot Auth signature from "ChatGPT Work" was captured matching
 * its published key exactly. See PLAN.md "Tier 2 — real operator trust".
 *
 * Adding another operator once they publish a directory is one line.
 */
export interface RegistryEntry {
  /** Must match Signature-Agent's URI exactly — never fetched from anywhere else. */
  origin: string;
  label: string;
  operator: string;
}

export const REGISTRY: RegistryEntry[] = [
  { origin: "https://chatgpt.com", label: "ChatGPT", operator: "OpenAI" },
];

export function findRegistryEntry(origin: string): RegistryEntry | undefined {
  return REGISTRY.find((e) => e.origin === origin);
}
