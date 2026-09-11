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
 */
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
    $("chart-title").textContent = "Visits per day, by category — this page only";
    $("top-pages-wrap").hidden = true;
    // Drop the redundant "Page" column in per-page mode — every row shares it.
    $("log-head").innerHTML = `<tr><th>Time</th><th>Visitor</th><th>Category</th><th>AI referral</th><th>Country</th></tr>`;
  } else {
    crumbs.innerHTML = `Overview — all pages`;
    $("section-title").textContent = "Overview — all pages";
    $("scope-hint").textContent = "";
    $("chart-title").textContent = "Visits per day, by category";
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

/** Pivot the {day, visitor_category, n} rows into {day: {human, agent, search, training, unrecognized}}. */
function pivotDaily(daily) {
  const byDay = new Map();
  for (const row of daily) {
    if (!byDay.has(row.day)) byDay.set(row.day, { human: 0, agent: 0, search: 0, training: 0, unrecognized: 0 });
    const bucket = byDay.get(row.day);
    if (row.visitor_category in bucket) bucket[row.visitor_category] = row.n;
  }
  return [...byDay.entries()].map(([day, counts]) => ({ day, counts })).sort((a, b) => a.day.localeCompare(b.day));
}

function renderChart(daily) {
  const days = pivotDaily(daily);
  const wrap = $("chart");
  if (days.length === 0) {
    wrap.innerHTML = `<p class="hint">No visits yet — load a page on eleviq.solutions and refresh.</p>`;
    $("legend").innerHTML = "";
    return;
  }

  const W = 760, H = 220, padL = 34, padB = 28, padT = 10, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxTotal = Math.max(1, ...days.map((d) => CATS.reduce((s, c) => s + d.counts[c.key], 0)));
  const niceMax = Math.ceil(maxTotal / 5) * 5 || 5;
  const bandW = plotW / days.length;
  const barW = Math.min(48, bandW * 0.6);
  const gap = 2; // surface gap between stacked segments, per dataviz skill mark spec

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + plotH * (1 - f);
    const val = Math.round(niceMax * f);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="chart-grid" />
            <text x="${padL - 6}" y="${y + 3}" class="chart-axis-label" text-anchor="end">${val}</text>`;
  }).join("");

  const bars = days.map((d, i) => {
    const x = padL + i * bandW + (bandW - barW) / 2;
    let yCursor = padT + plotH;
    const segs = CATS.map((cat) => {
      const n = d.counts[cat.key];
      if (n === 0) return "";
      const segH = Math.max(0, (n / niceMax) * plotH - gap);
      yCursor -= segH + gap;
      return `<rect x="${x}" y="${yCursor}" width="${barW}" height="${segH}"
                style="fill:var(${cat.cssVar})" rx="2">
                <title>${d.day} · ${cat.label}: ${n}</title>
              </rect>`;
    }).join("");
    const label = new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${segs}<text x="${x + barW / 2}" y="${H - padB + 16}" class="chart-axis-label" text-anchor="middle">${label}</text>`;
  }).join("");

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="viz-root chart-svg" role="img" aria-label="Visits per day, stacked by visitor category">
    ${gridlines}
    ${bars}
  </svg>`;

  $("legend").innerHTML = CATS.map(
    (c) => `<span class="legend-item"><span class="legend-swatch" style="background:var(${c.cssVar})"></span>${c.label}</span>`,
  ).join("");
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
    renderChart(data.daily);
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
$("refresh").addEventListener("click", load);
load();
