import type { Env } from "./env";
import type { VisitorCategory } from "./classify";

export interface PageViewEntry {
  path: string;
  visitor: string;
  visitorCategory: VisitorCategory;
  cfBotCategory: string | null;
  referrerAgent: string | null;
  country: string | null;
}

/** Fire-and-forget — a logging failure must never affect the response. */
export function logPageView(env: Env, ctx: ExecutionContext, entry: PageViewEntry): void {
  const write = env.DB.prepare(
    `INSERT INTO page_views (ts, path, visitor, visitor_category, cf_bot_category, referrer_agent, country)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    new Date().toISOString(),
    entry.path,
    entry.visitor,
    entry.visitorCategory,
    entry.cfBotCategory,
    entry.referrerAgent,
    entry.country,
  );
  ctx.waitUntil(write.run().catch((err) => console.error("page view log write failed:", err)));
}
