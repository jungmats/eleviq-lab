/**
 * eleviq.solutions site logger.
 *
 * A transparent passthrough Worker bound to eleviq.solutions/* and
 * www.eleviq.solutions/* (see wrangler.toml's [[routes]] — commented out
 * until deliberately enabled, see PLAN.md). It fetches the real origin
 * (GitHub Pages) and returns that response completely unchanged; the only
 * side effect is an anonymous, async log entry for HTML page responses —
 * who came (human vs. which agent, by User-Agent signature — see
 * lib/classify.ts for the human/search/training/agent/unrecognized
 * categories), whether a known AI assistant referred them, Cloudflare's own
 * bot-category signal, and country. No cookies, no persistent visitor id,
 * no raw IP. Logging every category for now — not filtering training/search
 * crawlers out yet, deliberately, until there's real data to decide from.
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
      // response.ok excludes 404s and other error responses — GitHub Pages
      // serves its 404 page as text/html too, so without this check every
      // guessed/probed URL (bots and vulnerability scanners alike guessing
      // at /openapi.json, /.well-known/agent-card.json, /.git/config, …)
      // got logged as if it were a real page view of a page that doesn't
      // exist. Confirmed: none of those paths are actually hosted here.
      if (contentType.includes("text/html") && response.ok) {
        const cf = request.cf as { country?: string; verifiedBotCategory?: string } | undefined;
        const visitor = classifyVisitor(request.headers.get("User-Agent"));
        logPageView(env, ctx, {
          path: url.pathname,
          visitor: visitor.name,
          visitorCategory: visitor.category,
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
