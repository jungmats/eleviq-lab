/**
 * eleviq.solutions site logger.
 *
 * A transparent passthrough Worker bound to eleviq.solutions/* and
 * www.eleviq.solutions/* (see wrangler.toml's [[routes]] — commented out
 * until deliberately enabled, see PLAN.md). It fetches the real origin
 * (GitHub Pages) and returns that response completely unchanged; the only
 * side effect is an anonymous, async log entry for HTML page responses —
 * who came (human vs. which agent, by User-Agent signature), whether a
 * known AI assistant referred them, Cloudflare's own bot-category signal,
 * and country. No cookies, no persistent visitor id, no raw IP.
 *
 * Demo 4 (Measure), Part B — see PLAN.md and identity/index.html for how
 * this differs from the lab's own access_log (Part A): this is real
 * production traffic to eleviq.solutions itself, not the lab.
 *
 * SAFETY: this Worker sits in the request path of the live production site.
 * The origin fetch and the response returned to the visitor must never
 * depend on logging succeeding — logging is fire-and-forget and wrapped so
 * it cannot throw into the response path. See classify.ts / log.ts.
 */
import { classifyVisitor, classifyReferrer } from "./lib/classify";
import { logPageView } from "./lib/log";
import type { Env } from "./lib/env";

// The true origin behind eleviq.solutions — bypassing Cloudflare's own proxy
// for this outbound fetch (via cf.resolveOverride below) avoids an infinite
// loop back through this same Worker, which owns the zone's routes.
const ORIGIN_HOST = "jungmats.github.io";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    let response: Response;
    try {
      response = await fetch(request, { cf: { resolveOverride: ORIGIN_HOST } });
    } catch {
      // Fallback: a plain fetch, in case resolveOverride itself is ever the
      // problem. Still origin content, just without the loop-safe override.
      response = await fetch(request);
    }

    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        const cf = request.cf as { country?: string; verifiedBotCategory?: string } | undefined;
        logPageView(env, ctx, {
          path: url.pathname,
          visitor: classifyVisitor(request.headers.get("User-Agent")),
          cfBotCategory: cf?.verifiedBotCategory || null,
          referrerAgent: classifyReferrer(request.headers.get("Referer")),
          country: cf?.country ?? null,
        });
      }
    } catch (err) {
      // Never let a classification/logging bug affect the response.
      console.error("site-logger: logging step failed:", err);
    }

    return response;
  },
};
