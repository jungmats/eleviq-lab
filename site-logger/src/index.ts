/**
 * eleviq.solutions site — agent-content edge Worker.
 *
 * A passthrough Worker bound to eleviq.solutions/* and www.eleviq.solutions/*
 * (see wrangler.toml's [[routes]]). Fetches the real origin (GitHub Pages)
 * and runs a small pipeline of independent, config-driven features over
 * the response — see config.ts to enable/disable any of them:
 *
 *   - markdown     serves a text/markdown representation of the same URL
 *                  when the request negotiates for it (Accept:
 *                  text/markdown) — see features/markdown/. Checklist 2.10.
 *   - linkHeaders  adds RFC 8288 `Link` discovery headers (sitemap,
 *                  llms.txt) — see features/link-headers.ts. Checklist 1.9.
 *   - logging      anonymous visitor logging (human vs. which named agent,
 *                  referring AI assistant, country) — see
 *                  features/logging/. No cookies, no persistent visitor
 *                  id, no raw IP.
 *
 * Each feature is a pure function over (request, response, ...config) with
 * no dependency on the others or on anything eleviq-specific beyond
 * config.ts — this Worker doubles as a template: for a client engagement,
 * keep the features they need and delete the rest.
 *
 * SAFETY: this sits in the request path of the live production site. The
 * origin fetch and the response returned to the visitor must never depend
 * on any feature succeeding — see each feature's own error handling.
 */
import { config } from "./config";
import { addDiscoveryLinkHeaders } from "./features/link-headers";
import { applyMarkdownNegotiation } from "./features/markdown";
import { logVisit } from "./features/logging";
import type { Env } from "./lib/env";

// The true origin behind eleviq.solutions — bypassing Cloudflare's own proxy
// for this outbound fetch (via cf.resolveOverride below) avoids an infinite
// loop back through this same Worker, which owns the zone's routes.
const ORIGIN_HOST = "jungmats.github.io";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(request, { cf: { resolveOverride: ORIGIN_HOST } });
    } catch {
      // Fallback: a plain fetch, in case resolveOverride itself is ever the
      // problem. Still origin content, just without the loop-safe override.
      response = await fetch(request);
    }

    if (config.markdown.enabled) {
      response = await applyMarkdownNegotiation(request, response);
    }

    if (config.linkHeaders.enabled) {
      response = addDiscoveryLinkHeaders(response, config.linkHeaders.links);
    }

    if (config.logging.enabled) {
      logVisit(request, response, env, ctx);
    }

    return response;
  },
};
