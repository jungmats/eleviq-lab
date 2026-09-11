/**
 * GET /api/insights — the dashboard's one data source. Reads
 * site-logger/schema.sql's page_views table (written by the site-logger
 * Worker on every HTML response to eleviq.solutions). Read-only.
 *
 * ?path=<exact pathname> narrows everything except top_pages (which only
 * makes sense as a whole-site view) to that one page. Exact match, not a
 * prefix — "/technologies.html" matches only that page, not
 * "/technologies.html?x=1" or a subpath.
 */
import { json } from "../lib/http";
import type { Env } from "../lib/env";

const ROW_LIMIT = 100;
const TOP_PAGES_LIMIT = 15;

interface SummaryRow {
  visitor_category: string;
  n: number;
}
interface DailyRow {
  day: string;
  visitor_category: string;
  n: number;
}
interface TopPageRow {
  path: string;
  n: number;
  agent_n: number;
}
interface EntryRow {
  ts: string;
  path: string;
  visitor: string;
  visitor_category: string;
  referrer_agent: string | null;
  country: string | null;
}

export async function handleInsights(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get("path"); // exact match, not a prefix

  // COALESCE: rows written before visitor_category existed (pre-migration —
  // see schema.sql) have NULL there, not a real category. Surface them as
  // their own "uncategorized" bucket rather than as SQL NULL — that keeps
  // the per-category counts summing to the total instead of silently
  // falling short, and avoids "null" leaking into the UI.
  const CAT = `COALESCE(visitor_category, 'uncategorized')`;

  const summaryStmt = path
    ? env.DB.prepare(`SELECT ${CAT} as visitor_category, COUNT(*) as n FROM page_views WHERE path = ? GROUP BY 1`).bind(path)
    : env.DB.prepare(`SELECT ${CAT} as visitor_category, COUNT(*) as n FROM page_views GROUP BY 1`);

  const dailyStmt = path
    ? env.DB.prepare(
        `SELECT substr(ts, 1, 10) as day, ${CAT} as visitor_category, COUNT(*) as n
         FROM page_views WHERE path = ? GROUP BY day, 2 ORDER BY day ASC`,
      ).bind(path)
    : env.DB.prepare(
        `SELECT substr(ts, 1, 10) as day, ${CAT} as visitor_category, COUNT(*) as n
         FROM page_views GROUP BY day, 2 ORDER BY day ASC`,
      );

  const recentStmt = path
    ? env.DB.prepare(
        `SELECT ts, path, visitor, ${CAT} as visitor_category, referrer_agent, country
         FROM page_views WHERE path = ? ORDER BY ts DESC LIMIT ?`,
      ).bind(path, ROW_LIMIT)
    : env.DB.prepare(
        `SELECT ts, path, visitor, ${CAT} as visitor_category, referrer_agent, country
         FROM page_views ORDER BY ts DESC LIMIT ?`,
      ).bind(ROW_LIMIT);

  const [summary, daily, recent, topPages] = await Promise.all([
    summaryStmt.all<SummaryRow>(),
    dailyStmt.all<DailyRow>(),
    recentStmt.all<EntryRow>(),
    // Whole-site only — "top pages" has no meaning once already scoped to one page.
    env.DB.prepare(
      `SELECT path, COUNT(*) as n, SUM(CASE WHEN visitor_category = 'agent' THEN 1 ELSE 0 END) as agent_n
       FROM page_views GROUP BY path ORDER BY n DESC LIMIT ?`,
    )
      .bind(TOP_PAGES_LIMIT)
      .all<TopPageRow>(),
  ]);

  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const row of summary.results ?? []) {
    byCategory[row.visitor_category] = row.n;
    total += row.n;
  }

  return json({
    path: path ?? null,
    summary: { total, by_category: byCategory },
    daily: daily.results ?? [],
    top_pages: path ? [] : topPages.results ?? [],
    entries: recent.results ?? [],
    row_limit: ROW_LIMIT,
  });
}
