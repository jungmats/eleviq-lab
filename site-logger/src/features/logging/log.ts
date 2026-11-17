import type { Env } from "../../lib/env.ts";
import type { VisitorCategory } from "./classify.ts";

/** One row of `page_views` — columns per requirements LOG-1. */
export interface PageViewEntry {
  path: string;
  /** Legacy (LOG-6): written until neither dashboard reads it. */
  visitor: string;
  /** Legacy (LOG-6). */
  visitorCategory: VisitorCategory;
  cfBotCategory: string | null;
  /** AI assistant the visit was referred by — Referer or utm_source (see referralSignal). */
  referrerAgent: string | null;
  referralSignal: "referer" | "utm" | null;
  country: string | null;
  uaMatch: string | null;
  /** Only non-browser or attested User-Agents (LOG-2); "" for an empty one. */
  uaRaw: string | null;
  /** Never null on new rows — null marks a row written before LOG-7. */
  sigStatus: "none" | "valid" | "invalid" | "unverifiable";
  sigAgent: string | null;
  internal: 0 | 1;
}

/** Writes one page view. The caller runs this inside ctx.waitUntil and catches errors. */
export async function writePageView(env: Env, entry: PageViewEntry): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO page_views (ts, path, visitor, visitor_category, cf_bot_category, referrer_agent, country,
                             ua_match, ua_raw, sig_status, sig_agent, referral_signal, internal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      new Date().toISOString(),
      entry.path,
      entry.visitor,
      entry.visitorCategory,
      entry.cfBotCategory,
      entry.referrerAgent,
      entry.country,
      entry.uaMatch,
      entry.uaRaw,
      entry.sigStatus,
      entry.sigAgent,
      entry.referralSignal,
      entry.internal,
    )
    .run();
}
