/* ElevIQ Lab — Insights dashboard (Demo 4, Part B).
 *
 * One page, two modes, driven by the URL's ?path= query param (exact match,
 * not a prefix): no ?path -> "Overview" (all pages, includes the top-pages
 * table); ?path=/some/page.html -> that one page's own view (same stats +
 * chart + raw events, scoped; top-pages table hidden — it has no meaning
 * once already scoped to one page).
 *
 * Same-origin API (this Worker serves both the static page and /api/insights),
 * so no gateway URL indirection needed, unlike /measure/'s console.js.
 *
 * Stats, the daily chart and top pages cover the last 30 days. The monthly
 * chart is the all-time view.
 */
import { dayRange, isPartialMonth, monthRange, pivot, segmentHeight } from "./chart-data.js";

const params = new URLSearchParams(location.search);
const PATH = params.get("path"); // null in Overview mode

// Fixed categorical order — never reordered by data (see dataviz skill).
const CATS = [
  { key: "human", label: "Human", cssVar: "--cat2-human" },
  { key: "agent", label: "Agent", cssVar: "--cat2-agent" },
  { key: "search", label: "Search", cssVar: "--cat2-search" },
  { key: "training", label: "Training", cssVar: "--cat2-training" },
  { key: "unrecognized", label: "Unrecognized", cssVar: "--cat2-unrecognized" },
];
const CAT_KEYS = CATS.map((c) => c.key);

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function setupPathJump() {
  const input = $("path-input");
  if (PATH) input.value = PATH;
  $("path-jump").addEventListener("submit", (ev) => {
    ev.preventDefault();
    let value = input.value.trim();
    if (!value) {
      location.href = "./";
      return;
    }
    if (!value.startsWith("/")) value = "/" + value;
    location.href = `?path=${encodeURIComponent(value)}`;
  });
}

function setupModeChrome() {
  const crumbs = $("crumbs");
  if (PATH) {
    crumbs.innerHTML = `<a href="./">Overview</a> &nbsp;·&nbsp; Page: <code>${esc(PATH)}</code>`;
    $("section-title").textContent = `Page: ${PATH}`;
    $("scope-hint").innerHTML = `Scoped to this one page (exact match). <a href="./">Back to the overview</a>.`;
    $("chart-title").textContent = "Visits per day, by category — last 30 days, this page only";
    $("monthly-title").textContent = "Visits per month, by category — this page only";
    $("top-pages-wrap").hidden = true;
    // Drop the redundant "Page" column in per-page mode — every row shares it.
    $("log-head").innerHTML = `<tr><th>Time</th><th>Visitor</th><th>Category</th><th>AI referral</th><th>Country</th></tr>`;
  } else {
    crumbs.innerHTML = `Overview — all pages`;
    $("section-title").textContent = "Overview — all pages";
    $("scope-hint").textContent = "";
    $("chart-title").textContent = "Visits per day, by category — last 30 days";
    $("monthly-title").textContent = "Visits per month, by category";
    $("top-pages-wrap").hidden = false;
  }
}

function renderStats(summary) {
  const c = summary.by_category || {};
  $("stat-total").textContent = summary.total;
  $("stat-human").textContent = c.human || 0;
  $("stat-agent").textContent = c.agent || 0;
  $("stat-search").textContent = c.search || 0;
  $("stat-training").textContent = c.training || 0;
  $("stat-unrecognized").textContent = c.unrecognized || 0;
  const uncategorized = c.uncategorized || 0;
  $("stat-uncategorized").textContent = uncategorized;
  $("uncategorized-hint").hidden = uncategorized === 0;
}

function renderTopPages(topPages) {
  if (PATH) return; // hidden entirely in per-page mode
  const rows = topPages.map((p) => `<tr>
    <td><a href="?path=${encodeURIComponent(p.path)}">${esc(p.path)}</a></td>
    <td>${p.n}</td>
    <td>${p.agent_n}</td>
  </tr>`);
  $("top-pages-rows").innerHTML = rows.join("") || `<tr><td colspan="3">No visits logged yet.</td></tr>`;
}

function renderTable(entries) {
  const rows = entries.map((e) => {
    const referral = e.referrer_agent ? esc(e.referrer_agent) : "—";
    const cells = PATH
      ? `<td>${fmtTime(e.ts)}</td><td>${esc(e.visitor)}</td><td>${esc(e.visitor_category)}</td><td>${referral}</td><td>${esc(e.country || "—")}</td>`
      : `<td>${fmtTime(e.ts)}</td><td><a href="?path=${encodeURIComponent(e.path)}">${esc(e.path)}</a></td><td>${esc(e.visitor)}</td><td>${esc(e.visitor_category)}</td><td>${referral}</td><td>${esc(e.country || "—")}</td>`;
    return `<tr>${cells}</tr>`;
  });
  const colCount = PATH ? 5 : 6;
  $("log-rows").innerHTML = rows.join("") || `<tr><td colspan="${colCount}">No events logged yet.</td></tr>`;
  $("log-count").textContent = entries.length;
}

function dayBars(data) {
  const days = dayRange(data.window.from, data.window.to);
  return pivot(data.daily, "day", days, CAT_KEYS).map(({ period, counts }) => ({
    period,
    counts,
    label: new Date(`${period}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    partial: false,
  }));
}

function monthBars(data) {
  const months = monthRange(data.first_day ?? data.window.to, data.window.to);
  return pivot(data.monthly, "month", months, CAT_KEYS).map(({ period, counts }) => ({
    period,
    counts,
    label: new Date(`${period}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    partial: isPartialMonth(period, data.first_day ?? data.window.to, data.window.to),
  }));
}

function renderLegend() {
  $("legend").innerHTML = CATS.map(
    (c) => `<span class="legend-item"><span class="legend-swatch" style="background:var(${c.cssVar})"></span>${c.label}</span>`,
  ).join("");
}

/**
 * Stacked bars by visitor category. `labelEvery` thins the axis labels,
 * counting back from the last bar so the most recent one is always labelled.
 */
function renderChart(wrap, bars, { height, labelEvery = 1, ariaLabel, emptyText }) {
  const totalOf = (bar) => CATS.reduce((s, c) => s + bar.counts[c.key], 0);
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
  const gap = 2; // surface gap between stacked segments, per dataviz skill mark spec

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + plotH * (1 - f);
    const val = Math.round(niceMax * f);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="chart-grid" />
            <text x="${padL - 6}" y="${y + 3}" class="chart-axis-label" text-anchor="end">${val}</text>`;
  }).join("");

  const marks = bars.map((bar, i) => {
    const x = padL + i * bandW + (bandW - barW) / 2;
    let yCursor = padT + plotH;
    const segs = CATS.map((cat) => {
      const n = bar.counts[cat.key];
      if (n === 0) return "";
      const segH = segmentHeight(n, niceMax, plotH, gap);
      yCursor -= segH + gap;
      return `<rect x="${x}" y="${yCursor}" width="${barW}" height="${segH}"
                class="${bar.partial ? "chart-bar-partial" : ""}" style="fill:var(${cat.cssVar})" rx="2">
                <title>${bar.period} · ${cat.label}: ${n}</title>
              </rect>`;
    }).join("");
    const showLabel = (bars.length - 1 - i) % labelEvery === 0;
    const label = showLabel
      ? `<text x="${x + barW / 2}" y="${H - padB + 16}" class="chart-axis-label" text-anchor="middle">${bar.label}</text>`
      : "";
    return segs + label;
  }).join("");

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="viz-root chart-svg" role="img" aria-label="${ariaLabel}">
    ${gridlines}
    ${marks}
  </svg>`;
}

async function load() {
  const btn = $("refresh");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const qs = PATH ? `?path=${encodeURIComponent(PATH)}` : "";
    const res = await fetch(`/api/insights${qs}`);
    const data = await res.json();
    $("row-limit").textContent = data.row_limit;
    renderStats(data.summary);
    renderChart($("chart"), dayBars(data), {
      height: 220,
      labelEvery: 5,
      ariaLabel: "Visits per day for the last 30 days, stacked by visitor category",
      emptyText: "No visits in the last 30 days.",
    });
    renderChart($("chart-monthly"), monthBars(data), {
      height: 150,
      ariaLabel: "Visits per month, stacked by visitor category",
      emptyText: "No visits yet.",
    });
    renderTopPages(data.top_pages || []);
    renderTable(data.entries);
  } catch (err) {
    $("chart").innerHTML = `<p class="hint">Could not load: ${esc(String(err && err.message ? err.message : err))}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh";
  }
}

setupModeChrome();
setupPathJump();
renderLegend();
$("refresh").addEventListener("click", load);
load();
