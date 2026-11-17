/* View state for the Insights dashboard — pure, tested in test/view-state.test.mjs.
 *
 * Filters live in the URL query, so a view can be shared and survives reload.
 * Hide human visits is also remembered per browser in localStorage, read and
 * written through safeStorage, which never throws (requirements DSH-1, AC-5).
 * Precedence: URL beats storage.
 */

export const KINDS = ["people", "ai-assistant", "search", "ai-training", "other-bot", "unknown"];
export const MIN_LEVELS = ["all", "attested", "verified"];
export const FLAG_FILTERS = ["contradicted", "signature-invalid"];
export const EVENT_LIMITS = [10, 50, 100, 500];

const PREFIX = "eleviq-insights:";

/**
 * localStorage that never throws: private mode, blocked site data and
 * sandboxed previews make the accessor or its calls throw. Falls back to an
 * in-memory map so the page keeps working for the session.
 */
export function safeStorage(getStore = () => globalThis.localStorage) {
  const memory = new Map();
  return {
    get(key, fallback = null) {
      try {
        const v = getStore().getItem(PREFIX + key);
        if (v !== null) return v;
      } catch {
        /* storage unavailable */
      }
      return memory.has(key) ? memory.get(key) : fallback;
    },
    set(key, value) {
      memory.set(key, String(value));
      try {
        getStore().setItem(PREFIX + key, String(value));
      } catch {
        /* storage unavailable — kept in memory */
      }
    },
  };
}

/** URL query + storage → state. Unknown values fall back to defaults. */
export function readState(search, storage) {
  const p = new URLSearchParams(search);
  const hpUrl = p.get("hide_people");
  const hidePeople = hpUrl === "1" ? true : hpUrl === "0" ? false : storage.get("hide_people", "0") === "1";
  const min = MIN_LEVELS.includes(p.get("min")) ? p.get("min") : "all";
  const kindsRaw = p.get("kinds");
  let kinds = [...KINDS];
  if (kindsRaw) {
    const asked = kindsRaw.split(",");
    const valid = KINDS.filter((k) => asked.includes(k));
    if (valid.length) kinds = valid;
  }
  const flagged = FLAG_FILTERS.includes(p.get("flagged")) ? p.get("flagged") : null;
  const lang = p.get("lang") === "fr" ? "fr" : "en";
  const path = p.get("path") || null;
  const limit = EVENT_LIMITS.includes(Number(p.get("limit"))) ? Number(p.get("limit")) : 10;
  return { path, hidePeople, min, kinds, flagged, lang, limit };
}

/** State → URL query (defaults omitted, so plain URLs stay plain). */
export function toQuery(state) {
  const p = new URLSearchParams();
  if (state.path) p.set("path", state.path);
  if (state.hidePeople) p.set("hide_people", "1");
  if (state.min !== "all") p.set("min", state.min);
  if (state.kinds.length !== KINDS.length) p.set("kinds", state.kinds.join(","));
  if (state.flagged) p.set("flagged", state.flagged);
  if (state.lang !== "en") p.set("lang", state.lang);
  if (state.limit && state.limit !== 10) p.set("limit", String(state.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The query for /api/insights: same keys; Hide people always explicit. */
export function apiQuery(state) {
  const q = toQuery({ ...state, hidePeople: false });
  const p = new URLSearchParams(q);
  if (state.hidePeople) p.set("hide_people", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}
