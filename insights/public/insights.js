/* ElevIQ Lab — Insights dashboard.
 *
 * One page, two modes, driven by ?path= (exact match): no path → overview
 * (with top pages); ?path=/x.html → that page only. Every filter (Hide human
 * visits, minimum evidence, kinds, flagged-only, events shown) is in the URL
 * and sent to /api/insights, which applies it to every block (DSH-3).
 *
 * Customer-facing evidence wording comes only from the API's `legend`
 * (shared/legend.*.json, requirements §5.8) — never written here.
 */
import { dayRange, isPartialMonth, monthRange, pivot, segmentHeight } from "./chart-data.js";
import { apiQuery, KINDS, readState, safeStorage, toQuery } from "./view-state.js";

const storage = safeStorage();
const state = readState(location.search, storage);
let legend = null; // from the API

// Fixed series order — never reordered by data (dataviz: colour follows the entity).
const KIND_VARS = {
  people: "--kind-people",
  "ai-assistant": "--kind-ai-assistant",
  search: "--kind-search",
  "ai-training": "--kind-ai-training",
  "other-bot": "--kind-other-bot",
  unknown: "--kind-unknown",
};
const LEVEL_KEYS = ["verified", "attested", "declared", "none"];
const LEVEL_VARS = { verified: "--lvl-verified", attested: "--lvl-attested", declared: "--lvl-declared", none: "--lvl-none" };
const LEVEL_TEXT = { verified: "TXT-VERIFIED", attested: "TXT-ATTESTED", declared: "TXT-DECLARED" };
const FLAG_TEXT = { contradicted: "TXT-CONTRADICTED", "signature-invalid": "TXT-SIG-INVALID" };

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const kindLabel = (k) => (legend ? legend.kinds[k] : k);
const levelLabel = (l) => (l === "none" ? kindLabel("unknown") : legend ? legend.levels[l] : l);

function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(state.lang === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

// ---------------------------------------------------------------- state & URL

function hrefFor(patch) {
  return location.pathname + toQuery({ ...state, ...patch });
}

function applyState(patch) {
  Object.assign(state, patch);
  history.replaceState(null, "", hrefFor({}));
  storage.set("hide_people", state.hidePeople ? "1" : "0");
  load();
}

// ---------------------------------------------------------------- tooltips (DSH-5a)

/** One popover at a time: hover/focus on desktop, tap on touch, Escape / outside tap closes. */
function setupTooltips() {
  const tip = $("tip");
  let owner = null;
  const show = (el) => {
    owner = el;
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 32);
    tip.style.maxWidth = `${w}px`;
    const left = Math.max(16, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - w - 16));
    tip.style.left = `${left}px`;
    tip.style.top = `${window.scrollY + r.bottom + 6}px`;
  };
  const hide = () => {
    owner = null;
    tip.hidden = true;
  };
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) show(el);
  });
  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el && el === owner && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) show(el);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === owner) hide();
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) {
      e.preventDefault();
      if (owner === el && !tip.hidden) hide();
      else show(el);
    } else hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}

const tipAttr = (text) => `data-tip="${esc(text)}" tabindex="0"`;

/** Evidence badge (DSH-4) + flag markers (DSH-10) + note markers. */
function evidenceCell(e) {
  if (e.kind === "people") {
    return `<span class="people-tag" ${tipAttr(legend.texts["TXT-PEOPLE"])}>${esc(kindLabel("people"))}</span>`;
  }
  const parts = [];
  if (e.level) {
    const text = `${legend.texts[LEVEL_TEXT[e.level]]}${e.method ? ` (${e.method})` : ""}`;
    parts.push(`<span class="ev-badge ev-${e.level}" ${tipAttr(text)}>${esc(legend.levels[e.level])}</span>`);
  } else {
    parts.push(`<span class="ev-badge ev-none">—</span>`);
  }
  for (const f of e.flags) {
    if (FLAG_TEXT[f]) {
      parts.push(`<span class="flag-marker flag-${f}" ${tipAttr(legend.texts[FLAG_TEXT[f]])}><span aria-hidden="true">${f === "contradicted" ? "!" : "✕"}</span> ${esc(legend.flags[f])}</span>`);
    } else if (f === "internal") {
      parts.push(`<span class="flag-marker flag-internal">ElevIQ test</span>`);
    }
  }
  for (const n of e.notes) {
    if (n === "sig-unchecked") {
      parts.push(`<span class="note-marker" ${tipAttr(legend.texts["TXT-SIG-UNCHECKED"])}>${esc(legend.notes[n])}</span>`);
    }
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------- controls

function setupControls() {
  const hp = $("hide-people");
  hp.checked = state.hidePeople;
  hp.addEventListener("change", () => applyState({ hidePeople: hp.checked }));

  const min = $("min-level");
  min.value = state.min;
  min.addEventListener("change", () => applyState({ min: min.value }));

  const fl = $("flagged");
  fl.value = state.flagged ?? "";
  fl.addEventListener("change", () => applyState({ flagged: fl.value || null }));

  const lim = $("limit");
  lim.value = String(state.limit);
  lim.addEventListener("change", () => applyState({ limit: Number(lim.value) }));

  // DSH-5: explanations open as overlays from the (i) buttons.
  setupDialog("legend-info", "legend-dialog");
  setupDialog("kinds-info", "kinds-dialog");

  const input = $("path-input");
  if (state.path) input.value = state.path;
  $("path-jump").addEventListener("submit", (ev) => {
    ev.preventDefault();
    let value = input.value.trim();
    if (value && !value.startsWith("/")) value = "/" + value;
    location.href = hrefFor({ path: value || null, flagged: null });
  });

  $("refresh").addEventListener("click", load);
}

/** Modal overlay: opened by its (i) button; closed by ×, Escape (native) or a click outside. */
function setupDialog(buttonId, dialogId) {
  const dlg = $(dialogId);
  $(buttonId).addEventListener("click", () => {
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close ? dlg.close() : dlg.removeAttribute("open");
  });
}

function renderKindChecks() {
  $("kind-checks").innerHTML = KINDS.map(
    (k) => `<label class="kind-check"><input type="checkbox" value="${k}" ${state.kinds.includes(k) ? "checked" : ""}>
      <span class="legend-swatch" style="background:var(${KIND_VARS[k]})"></span>${esc(kindLabel(k))}</label>`,
  ).join("");
  for (const box of $("kind-checks").querySelectorAll("input")) {
    box.addEventListener("change", () => {
      const kinds = [...$("kind-checks").querySelectorAll("input:checked")].map((b) => b.value);
      if (!kinds.length) {
        box.checked = true; // at least one kind stays selected
        return;
      }
      applyState({ kinds });
    });
  }
}

function setupModeChrome() {
  const crumbs = $("crumbs");
  if (state.path) {
    crumbs.innerHTML = `<a href="${esc(hrefFor({ path: null, flagged: null }))}">Overview</a> &nbsp;·&nbsp; Page: <code>${esc(state.path)}</code>`;
    $("section-title").textContent = `Page: ${state.path}`;
    $("scope-hint").innerHTML = `Scoped to this one page (exact match). <a href="${esc(hrefFor({ path: null, flagged: null }))}">Back to the overview</a>.`;
    $("chart-title").textContent = "Visits per day, by kind — last 30 days, this page only";
    $("monthly-title").textContent = "Visits per month, by kind — this page only";
    $("levels-title").textContent = "Visits per month, by evidence level — AI and bots only, this page only";
    $("top-pages-wrap").hidden = true;
  } else {
    crumbs.textContent = "Overview — all pages";
    $("top-pages-wrap").hidden = false;
  }
}

// ---------------------------------------------------------------- rendering

function renderLegendPanel() {
  $("legend-title").textContent = legend.panelTitle;
  $("legend-info").title = legend.panelTitle;
  $("legend-info").setAttribute("aria-label", legend.panelTitle);
  $("kinds-title").textContent = legend.kindsTitle;
  $("kinds-info").title = legend.kindsTitle;
  $("kinds-info").setAttribute("aria-label", legend.kindsTitle);
  $("kinds-body").innerHTML = `<dl class="legend-defs">${KINDS.map((k) => `
      <dt><span class="kind-name"><span class="legend-swatch" style="background:var(${KIND_VARS[k]})"></span>${esc(legend.kinds[k])}</span></dt>
      <dd>${esc(legend.kindTexts[k])}</dd>`).join("")}</dl>`;
  const t = legend.texts;
  $("legend-body").innerHTML = `
    <dl class="legend-defs">
      <dt><span class="ev-badge ev-verified">${esc(legend.levels.verified)}</span></dt><dd>${esc(t["TXT-VERIFIED"])}</dd>
      <dt><span class="ev-badge ev-attested">${esc(legend.levels.attested)}</span></dt><dd>${esc(t["TXT-ATTESTED"])}</dd>
      <dt><span class="ev-badge ev-declared">${esc(legend.levels.declared)}</span></dt><dd>${esc(t["TXT-DECLARED"])}</dd>
      <dt><span class="people-tag">${esc(legend.kinds.people)}</span></dt><dd>${esc(t["TXT-PEOPLE"])}</dd>
      <dt><span class="flag-marker flag-contradicted"><span aria-hidden="true">!</span> ${esc(legend.flags.contradicted)}</span></dt><dd>${esc(t["TXT-CONTRADICTED"])}</dd>
      <dt><span class="flag-marker flag-signature-invalid"><span aria-hidden="true">✕</span> ${esc(legend.flags["signature-invalid"])}</span></dt><dd>${esc(t["TXT-SIG-INVALID"])}</dd>
      <dt><span class="note-marker">${esc(legend.notes["sig-unchecked"])}</span></dt><dd>${esc(t["TXT-SIG-UNCHECKED"])}</dd>
    </dl>
    <p class="legend-limits">${esc(t["TXT-LIMITS"])}</p>`;
  $("flagged-contradicted").textContent = legend.flags.contradicted;
  $("flagged-invalid").textContent = legend.flags["signature-invalid"];
}

function renderNotes(data) {
  $("banner-internal").hidden = !data.show_internal; // INT-4
  const lines = [];
  const sig = data.notes.sig_checked_from;
  const int = data.notes.internal_from;
  // DSH-13, INT-5 (wording from the requirements).
  if (sig.reaches_before) lines.push(sig.date ? `Signatures not checked before ${fmtDate(sig.date)}.` : "Signatures not checked yet.");
  if (int.reaches_before) lines.push(int.date ? `ElevIQ test traffic not separated before ${fmtDate(int.date)}.` : "ElevIQ test traffic not separated yet.");
  $("period-notes").innerHTML = lines.map((l) => `<p class="hint period-note">${esc(l)}</p>`).join("");
}

function renderStats(summary) {
  const kinds = state.kinds.filter((k) => !(state.hidePeople && k === "people"));
  $("stats-head").innerHTML = `<th>Total</th>` + kinds.map((k) => `<th>${esc(kindLabel(k))}</th>`).join("");
  $("stats-row").innerHTML = `<td>${summary.total}</td>` + kinds.map((k) => `<td>${summary.by_kind[k] ?? 0}</td>`).join("");
}

function renderAgents(agents) {
  const L = legend.levels;
  $("agents-head").innerHTML = `<tr><th>Agent</th><th>Kind</th><th>${esc(L.verified)}</th><th>${esc(L.attested)}</th><th>${esc(L.declared)}</th><th>${esc(legend.flags.contradicted)}</th><th>${esc(legend.flags["signature-invalid"])}</th><th>Total</th></tr>`;
  const cell = (n, cls = "") => `<td class="${n ? cls : "zero"}">${n}</td>`;
  $("agents-rows").innerHTML =
    agents.map((a) => `<tr>
      <td>${esc(a.name)}</td><td>${esc(a.kinds.map(kindLabel).join(" / "))}</td>
      ${cell(a.levels.verified)}${cell(a.levels.attested)}${cell(a.levels.declared)}
      ${cell(a.flags.contradicted, "num-contradicted")}${cell(a.flags["signature-invalid"], "num-invalid")}
      <td><b>${a.total}</b></td></tr>`).join("") || `<tr><td colspan="8">No named agents in this view.</td></tr>`;
}

function renderReferrals(referrals) {
  $("referrals-hint").hidden = !state.hidePeople;
  $("referrals-rows").innerHTML =
    referrals.map((r) => `<tr><td>${esc(r.by)}</td><td>${r.referer}</td><td>${r.utm}</td><td><b>${r.total}</b></td></tr>`).join("") ||
    `<tr><td colspan="4">No referred visits in this view.</td></tr>`;
}

function renderTopPages(topPages) {
  if (state.path) return;
  $("top-pages-rows").innerHTML =
    topPages.map((p) => `<tr>
      <td><a href="${esc(hrefFor({ path: p.path, flagged: null }))}">${esc(p.path)}</a></td>
      <td>${p.n}</td><td>${p.ai_n}</td><td>${Math.round(p.share * 100)} %</td></tr>`).join("") ||
    `<tr><td colspan="4">No visits in this view.</td></tr>`;
}

function renderTable(data) {
  const entries = data.entries;
  const pageCol = !state.path;
  $("log-head").innerHTML = `<tr><th>Time</th>${pageCol ? "<th>Page</th>" : ""}<th>Visitor</th><th>Kind</th><th>Evidence</th><th>Referred by</th><th>Country</th></tr>`;
  $("log-rows").innerHTML =
    entries.map((e) => {
      const ref = e.referral ? `${esc(e.referral.by)} <span class="muted">(${e.referral.signal === "utm" ? "utm" : "link"})</span>` : "—";
      const visitor = e.kind === "people" ? "—" : esc(e.name ?? "—");
      return `<tr><td>${fmtTime(e.ts)}</td>
        ${pageCol ? `<td><a href="${esc(hrefFor({ path: e.path, flagged: null }))}">${esc(e.path)}</a></td>` : ""}
        <td>${visitor}</td><td>${esc(kindLabel(e.kind))}</td><td class="ev-cell">${evidenceCell(e)}</td>
        <td>${ref}</td><td>${esc(e.country || "—")}</td></tr>`;
    }).join("") || `<tr><td colspan="${pageCol ? 7 : 6}">No events in this view.</td></tr>`;
  $("log-count-hint").textContent =
    entries.length < state.limit
      ? `${entries.length} ${entries.length === 1 ? "event matches" : "events match"}${data.entries_capped ? ` within the newest ${data.entries_scanned} visits` : ""}.`
      : "";
  $("log-scope").textContent = "";
}

function renderSwatches(el, keys, vars, label) {
  el.innerHTML = keys
    .map((k) => `<span class="legend-item"><span class="legend-swatch" style="background:var(${vars[k]})"></span>${esc(label(k))}</span>`)
    .join("");
}

function dayBars(data, keys) {
  const days = dayRange(data.window.from, data.window.to);
  return pivot(data.daily, "day", days, keys).map(({ period, counts }) => ({
    period,
    counts,
    label: new Date(`${period}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    partial: false,
  }));
}

function monthBars(rows, data, keys) {
  const months = monthRange(data.first_day ?? data.window.to, data.window.to);
  return pivot(rows, "month", months, keys).map(({ period, counts }) => ({
    period,
    counts,
    label: new Date(`${period}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    partial: isPartialMonth(period, data.first_day ?? data.window.to, data.window.to),
  }));
}

/**
 * Stacked bars. `series` = [{ key, label, cssVar }] in fixed order.
 * `labelEvery` thins axis labels, counting back from the last bar.
 */
function renderChart(wrap, bars, series, { height, labelEvery = 1, ariaLabel, emptyText }) {
  const totalOf = (bar) => series.reduce((s, c) => s + bar.counts[c.key], 0);
  if (bars.every((bar) => totalOf(bar) === 0)) {
    wrap.innerHTML = `<p class="hint">${emptyText}</p>`;
    return;
  }
  const W = 760, H = height, padL = 34, padB = 28, padT = 10, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxTotal = Math.max(1, ...bars.map(totalOf));
  const niceMax = Math.ceil(maxTotal / 5) * 5 || 5;
  const bandW = plotW / bars.length;
  const barW = Math.min(48, bandW * 0.6);
  const gap = 2;

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + plotH * (1 - f);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="chart-grid" />
            <text x="${padL - 6}" y="${y + 3}" class="chart-axis-label" text-anchor="end">${Math.round(niceMax * f)}</text>`;
  }).join("");

  const marks = bars.map((bar, i) => {
    const x = padL + i * bandW + (bandW - barW) / 2;
    let yCursor = padT + plotH;
    const segs = series.map((s) => {
      const n = bar.counts[s.key];
      if (n === 0) return "";
      const segH = segmentHeight(n, niceMax, plotH, gap);
      yCursor -= segH + gap;
      return `<rect x="${x}" y="${yCursor}" width="${barW}" height="${segH}"
                class="${bar.partial ? "chart-bar-partial" : ""}" style="fill:var(${s.cssVar})" rx="2">
                <title>${esc(bar.label)} · ${esc(s.label)}: ${n}</title></rect>`;
    }).join("");
    const label = (bars.length - 1 - i) % labelEvery === 0
      ? `<text x="${x + barW / 2}" y="${H - padB + 16}" class="chart-axis-label" text-anchor="middle">${esc(bar.label)}</text>`
      : "";
    return segs + label;
  }).join("");

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="viz-root chart-svg" role="img" aria-label="${esc(ariaLabel)}">${gridlines}${marks}</svg>`;
}

function renderCharts(data) {
  const kinds = KINDS.filter((k) => state.kinds.includes(k) && !(state.hidePeople && k === "people"));
  const kindSeries = kinds.map((k) => ({ key: k, label: kindLabel(k), cssVar: KIND_VARS[k] }));
  renderSwatches($("legend"), kinds, KIND_VARS, kindLabel);
  renderChart($("chart"), dayBars(data, kinds), kindSeries, {
    height: 220, labelEvery: 5,
    ariaLabel: "Visits per day for the last 30 days, stacked by kind",
    emptyText: "No visits in the last 30 days for this view.",
  });
  renderChart($("chart-monthly"), monthBars(data.monthly, data, kinds), kindSeries, {
    height: 150,
    ariaLabel: "Visits per month, stacked by kind",
    emptyText: "No visits yet for this view.",
  });
  const levelSeries = LEVEL_KEYS.map((l) => ({ key: l, label: levelLabel(l), cssVar: LEVEL_VARS[l] }));
  renderSwatches($("legend-levels"), LEVEL_KEYS, LEVEL_VARS, levelLabel);
  renderChart($("chart-levels"), monthBars(data.monthly_levels, data, LEVEL_KEYS), levelSeries, {
    height: 150,
    ariaLabel: "AI and bot visits per month, stacked by evidence level",
    emptyText: "No AI or bot visits for this view.",
  });
}

// ---------------------------------------------------------------- load

async function load() {
  const btn = $("refresh");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const res = await fetch(`/api/insights${apiQuery(state)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    const first = !legend;
    legend = data.legend;
    if (first) renderKindChecks();
    renderLegendPanel();
    renderNotes(data);
    renderStats(data.summary);
    renderCharts(data);
    renderAgents(data.agents);
    renderReferrals(data.referrals);
    renderTopPages(data.top_pages || []);
    renderTable(data);
  } catch (err) {
    $("chart").innerHTML = `<p class="hint">Could not load: ${esc(String(err && err.message ? err.message : err))}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh";
  }
}

document.documentElement.lang = state.lang;
setupModeChrome();
setupControls();
setupTooltips();
load();
