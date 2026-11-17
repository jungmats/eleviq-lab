import assert from "node:assert/strict";
import { test } from "node:test";
import { apiQuery, KINDS, readState, safeStorage, toQuery } from "../public/view-state.js";

function fakeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
}
const throwing = () => {
  throw new Error("SecurityError: storage disabled");
};
const throwingCalls = () => ({
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("QuotaExceeded");
  },
});

test("safeStorage persists through a working store", () => {
  const store = fakeStore();
  const s = safeStorage(() => store);
  s.set("hide_people", "1");
  assert.equal(safeStorage(() => store).get("hide_people"), "1", "survives a new page (reload)");
});

test("AC-5: a throwing accessor or throwing calls never throw; defaults and writes still work", () => {
  for (const getStore of [throwing, throwingCalls]) {
    const s = safeStorage(getStore);
    assert.equal(s.get("hide_people", "0"), "0");
    assert.doesNotThrow(() => s.set("hide_people", "1"));
    assert.equal(s.get("hide_people", "0"), "1", "kept in memory for the session");
    const state = readState("", s);
    assert.equal(state.hidePeople, true);
  }
});

test("defaults: people shown, all evidence, all kinds", () => {
  const st = readState("", safeStorage(throwing));
  assert.deepEqual(st, { path: null, hidePeople: false, min: "all", kinds: KINDS, flagged: null, lang: "en", limit: 10 });
  assert.equal(toQuery(st), "");
});

test("URL beats storage for Hide people", () => {
  const store = fakeStore();
  const s = safeStorage(() => store);
  s.set("hide_people", "1");
  assert.equal(readState("?hide_people=0", s).hidePeople, false);
  assert.equal(readState("", s).hidePeople, true);
});

test("URL round trip", () => {
  const st = { path: "/fr/", hidePeople: true, min: "attested", kinds: ["ai-assistant", "search"], flagged: "contradicted", lang: "fr", limit: 50 };
  assert.deepEqual(readState(toQuery(st), safeStorage(throwing)), st);
});

test("unknown values fall back to defaults", () => {
  const st = readState("?min=high&kinds=robots&flagged=internal&lang=de&limit=7", safeStorage(throwing));
  assert.equal(st.limit, 10);
  assert.equal(st.min, "all");
  assert.deepEqual(st.kinds, KINDS);
  assert.equal(st.flagged, null);
  assert.equal(st.lang, "en");
});

test("API query carries Hide people explicitly", () => {
  assert.equal(apiQuery({ path: null, hidePeople: true, min: "all", kinds: KINDS, flagged: null, lang: "en", limit: 10 }), "?hide_people=1");
  assert.equal(apiQuery({ path: null, hidePeople: false, min: "all", kinds: KINDS, flagged: null, lang: "en", limit: 500 }), "?limit=500");
  assert.equal(apiQuery({ path: "/", hidePeople: false, min: "verified", kinds: KINDS, flagged: null, lang: "en" }), "?path=%2F&min=verified");
});
