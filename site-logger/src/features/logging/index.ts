import { classifyVisitor, classifyReferrer } from "./classify";
import { logPageView } from "./log";
import { isPageView } from "./page-view";
import type { Env } from "../../lib/env";

/**
 * Fire-and-forget visitor logging for a page response — see page-view.ts for
 * what counts as a page view. Wrapped so a classification/logging bug can
 * never affect the response (logPageView's own D1 write is separately
 * fire-and-forget too — see log.ts).
 */
export function logVisit(request: Request, response: Response, env: Env, ctx: ExecutionContext): void {
  try {
    if (!isPageView(request, response)) return;

    const cf = request.cf as { country?: string; verifiedBotCategory?: string } | undefined;
    const visitor = classifyVisitor(request.headers.get("User-Agent"));
    logPageView(env, ctx, {
      path: new URL(request.url).pathname,
      visitor: visitor.name,
      visitorCategory: visitor.category,
      cfBotCategory: cf?.verifiedBotCategory || null,
      referrerAgent: classifyReferrer(request.headers.get("Referer")),
      country: cf?.country ?? null,
    });
  } catch (err) {
    console.error("site-logger: logging step failed:", err);
  }
}
