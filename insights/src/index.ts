/**
 * ElevIQ Lab — insights dashboard (Demo 4, Part B).
 *
 * Serves the eleviq.solutions traffic dashboard: a static page + JS from
 * public/ (via the Workers Assets binding — see wrangler.toml's [assets]),
 * plus one JSON API route, /api/insights, reading the same D1 database
 * site-logger writes to (eleviq-site-log). Read-only: this Worker never
 * writes a row — that's site-logger's job.
 *
 * Meant to be bound to insights.eleviq.solutions and protected by
 * Cloudflare Access (identity-aware edge auth). Unlike Demo 1 / Part A
 * (public, demo-only data), this is real production visitor data about
 * eleviq.solutions itself, so it is not left open. See PLAN.md.
 */
import { handleInsights } from "./routes/insights";
import { json } from "./lib/http";
import type { Env } from "./lib/env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/insights" && request.method === "GET") {
      try {
        return await handleInsights(request, env);
      } catch (err) {
        return json({ error: "insights_error", detail: String((err as Error)?.message ?? err) }, 500);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found", endpoints: ["/api/insights"] }, 404);
    }

    // Static files (public/) are matched before this Worker runs at all —
    // this is only a fallback for anything the assets binding didn't serve.
    return env.ASSETS.fetch(request);
  },
};
