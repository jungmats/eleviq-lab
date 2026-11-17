/**
 * Visitor aggregation for the insights dashboard — pure, no D1.
 *
 * SQL groups page views by their stored signals (plus period / path); each
 * distinct signal tuple is classified once with the shared `deriveVisitor`
 * (requirements CLS-1, CLS-10), then filtered and aggregated here. Rules
 * therefore apply to all history without data migrations.
 *
 * Requirements: agent-analytics/requirements-visitor-evidence.md DSH-1–13, INT-3–5.
 */
import { deriveVisitor, signalKey, type Flag, type Kind, type Level, type VisitorClass, type VisitorSignals } from "../../../shared/index.ts";

export const KINDS: readonly Kind[] = ["people", "ai-assistant", "search", "ai-training", "other-bot", "unknown"];
export const LEVELS: readonly (Level | "none")[] = ["verified", "attested", "declared", "none"];
export const MIN_LEVELS = ["all", "attested", "verified"] as const;
export const FLAG_FILTERS = ["contradicted", "signature-invalid"] as const;
export const EVENT_LIMITS = [10, 50, 100, 500] as const;
export type MinLevel = (typeof MIN_LEVELS)[number];
export type FlagFilter = (typeof FLAG_FILTERS)[number];

/** page_views columns that feed deriveVisitor (SIGNAL_FIELDS minus the journey-only ones). */
export const PAGE_VIEW_SIGNALS = [
  "ua_match",
  "ua_raw",
  "cf_bot_category",
  "sig_status",
  "sig_agent",
  "referrer_agent",
  "referral_signal",
  "internal",
  "visitor",
  "visitor_category",
] as const;

/** One SQL group: signals + count, optionally per period and path. */
export interface Tuple extends VisitorSignals {
  n: number;
  period?: string;
  path?: string;
}

export interface Filters {
  hidePeople: boolean;
  min: MinLevel;
  kinds: Kind[];
  /** Events table (and the tile's target) only. */
  flagged: FlagFilter | null;
  lang: "en" | "fr";
  /** Events shown (DSH-11); default 10. */
  limit: number;
}

export type ParseResult = { ok: true; filters: Filters } | { ok: false; error: string };

/** Query parameters → filters. Unknown values are an error, never silently ignored. */
export function parseFilters(params: URLSearchParams): ParseResult {
  const hp = params.get("hide_people");
  if (hp !== null && hp !== "0" && hp !== "1") return { ok: false, error: "hide_people must be 0 or 1" };

  const min = (params.get("min") ?? "all") as MinLevel;
  if (!MIN_LEVELS.includes(min)) return { ok: false, error: `min must be one of ${MIN_LEVELS.join(", ")}` };

  let kinds = [...KINDS];
  const k = params.get("kinds");
  if (k !== null && k !== "") {
    const asked = k.split(",").map((s) => s.trim()).filter(Boolean);
    const bad = asked.filter((x) => !KINDS.includes(x as Kind));
    if (bad.length) return { ok: false, error: `unknown kind(s) ${bad.join(", ")}; allowed: ${KINDS.join(", ")}` };
    kinds = KINDS.filter((x) => asked.includes(x));
  }

  const f = params.get("flagged");
  if (f !== null && f !== "" && !FLAG_FILTERS.includes(f as FlagFilter)) {
    return { ok: false, error: `flagged must be one of ${FLAG_FILTERS.join(", ")}` };
  }

  const limit = Number(params.get("limit") ?? 10);
  if (!(EVENT_LIMITS as readonly number[]).includes(limit)) return { ok: false, error: `limit must be one of ${EVENT_LIMITS.join(", ")}` };

  const lang = params.get("lang") ?? "en";
  if (lang !== "en" && lang !== "fr") return { ok: false, error: "lang must be en or fr" };

  return {
    ok: true,
    filters: { hidePeople: hp === "1", min, kinds, flagged: (f || null) as FlagFilter | null, lang, limit },
  };
}

/** Memoised deriveVisitor: one call per distinct signal tuple. */
export function classifier() {
  const cache = new Map<string, VisitorClass>();
  return (s: VisitorSignals): VisitorClass => {
    const key = signalKey(s);
    let c = cache.get(key);
    if (!c) {
      c = deriveVisitor(s);
      cache.set(key, c);
    }
    return c;
  };
}

/** DSH-1, DSH-2, DSH-9 (every view); DSH-11 only when `forEntries`. */
export function passes(c: VisitorClass, f: Filters, forEntries = false): boolean {
  if (f.hidePeople && c.kind === "people") return false;
  if (!f.kinds.includes(c.kind)) return false;
  if (f.min === "verified" && c.level !== "verified") return false;
  if (f.min === "attested" && c.level !== "verified" && c.level !== "attested") return false;
  if (forEntries && f.flagged && !c.flags.includes(f.flagged)) return false;
  return true;
}

const levelKey = (c: VisitorClass): Level | "none" => c.level ?? "none";

function add<K extends string>(m: Record<K, number>, k: K, n: number) {
  m[k] = (m[k] ?? 0) + n;
}

export interface AgentRow {
  name: string;
  /** Usually one; two when the evidence disagrees (e.g. Cloudflare: search, User-Agent list: AI training). Most visits first. */
  kinds: Kind[];
  total: number;
  levels: Record<Level | "none", number>;
  flags: Record<"contradicted" | "signature-invalid", number>;
}

export interface Aggregates {
  summary: {
    total: number;
    by_kind: Record<Kind, number>;
    by_level: Record<Level | "none", number>;
    flags: Record<"contradicted" | "signature-invalid", number>;
  };
  daily: { day: string; key: Kind; n: number }[];
  top_pages: { path: string; n: number; ai_n: number; share: number }[];
  agents: AgentRow[];
  referrals: { by: string; referer: number; utm: number; total: number }[];
}

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/**
 * Aggregates for the 30-day window. `tuples` are grouped by day (period),
 * path and signals. Top pages are only meaningful site-wide; the caller drops
 * them in ?path= mode.
 */
export function aggregateWindow(tuples: Tuple[], f: Filters, classify = classifier(), topLimit = 15): Aggregates {
  const byKind = zero(KINDS);
  const byLevel = zero(LEVELS);
  const flags = zero(FLAG_FILTERS);
  const daily = new Map<string, number>();
  const pages = new Map<string, { n: number; ai_n: number }>();
  const agents = new Map<string, AgentRow & { byKind: Record<string, number> }>();
  const refs = new Map<string, { referer: number; utm: number }>();
  let total = 0;

  for (const t of tuples) {
    const c = classify(t);
    if (!passes(c, f)) continue;
    total += t.n;
    add(byKind, c.kind, t.n);
    add(byLevel, levelKey(c), t.n);
    for (const fl of c.flags) if (fl === "contradicted" || fl === "signature-invalid") add(flags, fl, t.n);

    if (t.period) {
      const k = `${t.period}|${c.kind}`;
      daily.set(k, (daily.get(k) ?? 0) + t.n);
    }
    if (t.path) {
      const p = pages.get(t.path) ?? { n: 0, ai_n: 0 };
      p.n += t.n;
      if (c.kind !== "people") p.ai_n += t.n;
      pages.set(t.path, p);
    }
    if (c.kind !== "people" && c.name) {
      const a = agents.get(c.name) ?? { name: c.name, kinds: [], total: 0, levels: zero(LEVELS), flags: zero(FLAG_FILTERS), byKind: {} as Record<string, number> };
      a.byKind[c.kind] = (a.byKind[c.kind] ?? 0) + t.n;
      a.total += t.n;
      add(a.levels, levelKey(c), t.n);
      for (const fl of c.flags) if (fl === "contradicted" || fl === "signature-invalid") add(a.flags, fl, t.n);
      agents.set(c.name, a);
    }
    // DSH-7: people referred by an assistant.
    if (c.kind === "people" && c.referral) {
      const r = refs.get(c.referral.by) ?? { referer: 0, utm: 0 };
      r[c.referral.signal] += t.n;
      refs.set(c.referral.by, r);
    }
  }

  return {
    summary: { total, by_kind: byKind, by_level: byLevel, flags },
    daily: [...daily].map(([k, n]) => {
      const [day, key] = k.split("|");
      return { day, key: key as Kind, n };
    }),
    top_pages: [...pages]
      .map(([path, p]) => ({ path, n: p.n, ai_n: p.ai_n, share: p.n ? p.ai_n / p.n : 0 }))
      .sort((a, b) => b.n - a.n || a.path.localeCompare(b.path))
      .slice(0, topLimit),
    agents: [...agents.values()]
      .map(({ byKind, ...a }) => ({ ...a, kinds: (Object.keys(byKind) as Kind[]).sort((x, y) => byKind[y] - byKind[x]) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    referrals: [...refs]
      .map(([by, r]) => ({ by, ...r, total: r.referer + r.utm }))
      .sort((a, b) => b.total - a.total || a.by.localeCompare(b.by)),
  };
}

/** All-time monthly series: by kind (all filters) and by level (DSH-8, non-people only). */
export function aggregateMonthly(tuples: Tuple[], f: Filters, classify = classifier()) {
  const byKind = new Map<string, number>();
  const byLevel = new Map<string, number>();
  for (const t of tuples) {
    const c = classify(t);
    if (!passes(c, f) || !t.period) continue;
    const k = `${t.period}|${c.kind}`;
    byKind.set(k, (byKind.get(k) ?? 0) + t.n);
    if (c.kind !== "people") {
      const l = `${t.period}|${levelKey(c)}`;
      byLevel.set(l, (byLevel.get(l) ?? 0) + t.n);
    }
  }
  const rows = (m: Map<string, number>) =>
    [...m].map(([k, n]) => {
      const [month, key] = k.split("|");
      return { month, key, n };
    });
  return { monthly: rows(byKind), monthly_levels: rows(byLevel) };
}

/** One events-table row, derived. */
export interface Entry {
  ts: string;
  path: string;
  country: string | null;
  kind: Kind;
  level: Level | null;
  method: string | null;
  name: string | null;
  flags: Flag[];
  notes: string[];
  referral: { by: string; signal: string } | null;
}

export function toEntry(row: Tuple & { ts: string; path: string; country: string | null }, c: VisitorClass): Entry {
  return {
    ts: row.ts,
    path: row.path,
    country: row.country,
    kind: c.kind,
    level: c.level,
    method: c.method,
    name: c.name,
    flags: c.flags,
    notes: c.notes,
    referral: c.referral,
  };
}

/** DSH-13 / INT-5: date the signal started, and whether a period starting at `from` reaches before it. */
export function periodNote(startedAt: string | null, from: string | null) {
  if (!startedAt) return { date: null, reaches_before: true };
  return { date: startedAt.slice(0, 10), reaches_before: !!from && from < startedAt };
}
