/**
 * GET /api/insights — the dashboard's one data source. Reads site-logger's
 * page_views table (read-only) and classifies every row through the shared
 * `deriveVisitor` (see lib/visits.ts).
 *
 * Query parameters (all optional; every block honours them, DSH-3):
 *   path=<exact pathname>        scope to one page (top_pages then empty)
 *   hide_people=1                DSH-1
 *   min=all|attested|verified    DSH-2
 *   kinds=<csv>                  DSH-9
 *   flagged=contradicted|signature-invalid   DSH-11 (events only)
 *   limit=10|50|100|500          events shown (default 10)
 *   lang=en|fr                   legend texts
 *
 * Internal rows (ElevIQ's own test traffic) are excluded in SQL unless the
 * deployment sets SHOW_INTERNAL="true" (INT-3, INT-4) — no UI switch.
 *
 * summary, daily, top_pages, agents and referrals cover the last 30 days;
 * monthly and monthly_levels are all-time; entries are the newest matches.
 */
import { LEGENDS } from "../../../shared/index.ts";
import { json } from "../lib/http.ts";
import type { Env } from "../lib/env.ts";
import {
  aggregateMonthly,
  aggregateWindow,
  classifier,
  PAGE_VIEW_SIGNALS,
  parseFilters,
  passes,
  periodNote,
  toEntry,
  type Entry,
  type Tuple,
} from "../lib/visits.ts";

const SCAN_PAGE = 1000;
const SCAN_MAX = 20_000;
const TOP_PAGES_LIMIT = 15;
const WINDOW_DAYS = 30; // including today, in UTC like the stored timestamps
const DAY_MS = 24 * 60 * 60 * 1000;

const COLS = PAGE_VIEW_SIGNALS.join(", ");

export async function handleInsights(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseFilters(url.searchParams);
  if (!parsed.ok) return json({ error: "bad_request", detail: parsed.error }, 400);
  const f = parsed.filters;
  const path = url.searchParams.get("path") || null; // exact match, not a prefix
  const showInternal = env.SHOW_INTERNAL === "true";

  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (WINDOW_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);

  // Shared WHERE fragments; values always bound, never interpolated.
  const where: string[] = [];
  const binds: unknown[] = [];
  if (path) {
    where.push("path = ?");
    binds.push(path);
  }
  if (!showInternal) where.push("internal = 0");
  const and = (extra: string[] = []) => {
    const all = [...extra, ...where];
    return all.length ? `WHERE ${all.join(" AND ")}` : "";
  };

  const windowStmt = env.DB.prepare(
    `SELECT substr(ts, 1, 10) AS period, path, ${COLS}, COUNT(*) AS n
     FROM page_views ${and(["ts >= ?"])} GROUP BY period, path, ${COLS}`,
  ).bind(from, ...binds);

  const monthlyStmt = env.DB.prepare(
    `SELECT substr(ts, 1, 7) AS period, ${COLS}, COUNT(*) AS n
     FROM page_views ${and()} GROUP BY period, ${COLS}`,
  ).bind(...binds);

  const [win, months, firstDay, sigFrom] = await Promise.all([
    windowStmt.all<Tuple>(),
    monthlyStmt.all<Tuple>(),
    // Always site-wide: when logging started decides which month is partial.
    env.DB.prepare(`SELECT substr(MIN(ts), 1, 10) AS day FROM page_views`).first<{ day: string | null }>(),
    // DSH-13 / INT-5: signature checking and the internal marker went live together.
    env.DB.prepare(`SELECT MIN(ts) AS ts FROM page_views WHERE sig_status IS NOT NULL`).first<{ ts: string | null }>(),
  ]);

  const classify = classifier();
  const agg = aggregateWindow(win.results ?? [], f, classify, TOP_PAGES_LIMIT);
  const { monthly, monthly_levels } = aggregateMonthly(months.results ?? [], f, classify);

  // Events: newest rows passing every filter, scanned page by page.
  const entries: Entry[] = [];
  let scanned = 0;
  while (entries.length < f.limit && scanned < SCAN_MAX) {
    const page = await env.DB.prepare(
      `SELECT ts, path, country, ${COLS} FROM page_views ${and()} ORDER BY ts DESC LIMIT ? OFFSET ?`,
    )
      .bind(...binds, SCAN_PAGE, scanned)
      .all<Tuple & { ts: string; path: string; country: string | null }>();
    const rows = page.results ?? [];
    for (const row of rows) {
      const c = classify(row);
      if (passes(c, f, true)) entries.push(toEntry(row, c));
      if (entries.length >= f.limit) break;
    }
    scanned += rows.length;
    if (rows.length < SCAN_PAGE) break;
  }

  const first = firstDay?.day ?? null;
  return json({
    path,
    filters: { hide_people: f.hidePeople, min: f.min, kinds: f.kinds, flagged: f.flagged, lang: f.lang, limit: f.limit },
    window: { days: WINDOW_DAYS, from, to: today },
    first_day: first,
    show_internal: showInternal,
    notes: {
      // The monthly chart is all-time, so a note applies whenever data reaches back that far.
      sig_checked_from: periodNote(sigFrom?.ts ?? null, first),
      internal_from: periodNote(sigFrom?.ts ?? null, first),
    },
    summary: agg.summary,
    daily: agg.daily,
    monthly,
    monthly_levels,
    top_pages: path ? [] : agg.top_pages,
    agents: agg.agents,
    referrals: agg.referrals,
    entries,
    entries_scanned: scanned,
    entries_capped: entries.length < f.limit && scanned >= SCAN_MAX,
    row_limit: f.limit,
    legend: LEGENDS[f.lang],
  });
}
