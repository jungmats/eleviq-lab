/* ElevIQ Lab — Agent Access Dashboard (Demo 4, Part A).
 *
 * Reads GET /api/log from the gateway and renders: summary stat tiles, a
 * stacked bar chart (requests per day, by outcome), and a recent-requests
 * table. Chart built per the dataviz skill: fixed categorical color order,
 * validated CVD-safe palette (see PLAN.md), hover tooltips via native <title>,
 * a legend, and the table itself as the required non-color-dependent view.
 */
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const GATEWAY = (
  LOCAL
    ? "http://localhost:8787"
    : document.querySelector('meta[name="gateway"]')?.content ||
      "https://eleviq-lab-gateway.gateway-worker.workers.dev"
).replace(/\/+$/, "");

// Fixed categorical order — never reordered by data (see dataviz skill).
const CATS = [
  { key: "own", label: "Verified — own key", cssVar: "--cat-own" },
  { key: "registry", label: "Verified — chatgpt.com", cssVar: "--cat-registry" },
  { key: "unsigned", label: "Refused — unsigned", cssVar: "--cat-unsigned" },
  { key: "other_refused", label: "Refused — other", cssVar: "--cat-other" },
];

const $ = (id) => document.getElementById(id);

function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function renderStats(summary) {
  $("stat-total").textContent = summary.total;
  $("stat-verified").textContent = summary.verified;
  $("stat-refused").textContent = summary.refused;
  $("stat-registry").textContent = summary.by_tier["registry:https://chatgpt.com"] || 0;
}

function renderTable(entries) {
  const rows = entries.map((e) => {
    const outcomeClass = e.outcome === "verified" ? "v-ok" : (e.outcome === "unknown-key" || e.outcome === "replayed" ? "v-warn" : "v-bad");
    const verifiedAs = e.agent_name ? `${e.agent_name}${e.agent_operator ? ` (${e.agent_operator})` : ""}` : "—";
    const tier = e.trust_tier || "—";
    return `<tr>
      <td>${fmtTime(e.ts)}</td>
      <td><span class="${outcomeClass}">${e.outcome}</span></td>
      <td>${e.claimed_ua ? esc(e.claimed_ua) : "—"}</td>
      <td>${esc(verifiedAs)}</td>
      <td>${esc(tier)}</td>
    </tr>`;
  });
  $("log-rows").innerHTML = rows.join("") || `<tr><td colspan="5">No requests logged yet.</td></tr>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Pivot the {day, bucket, n} rows into {day: {own, registry, unsigned, other_refused}}. */
function pivotDaily(daily) {
  const byDay = new Map();
  for (const row of daily) {
    if (!byDay.has(row.day)) byDay.set(row.day, { own: 0, registry: 0, unsigned: 0, other_refused: 0 });
    byDay.get(row.day)[row.bucket] = row.n;
  }
  return [...byDay.entries()].map(([day, counts]) => ({ day, counts })).sort((a, b) => a.day.localeCompare(b.day));
}

function renderChart(daily) {
  const days = pivotDaily(daily);
  const wrap = $("chart");
  if (days.length === 0) {
    wrap.innerHTML = `<p class="hint">No requests yet — send one from Demo 1 and refresh.</p>`;
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
                fill="var(${cat.cssVar})" rx="2">
                <title>${d.day} · ${cat.label}: ${n}</title>
              </rect>`;
    }).join("");
    const label = new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${segs}<text x="${x + barW / 2}" y="${H - padB + 16}" class="chart-axis-label" text-anchor="middle">${label}</text>`;
  }).join("");

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="viz-root chart-svg" role="img" aria-label="Requests per day, stacked by outcome">
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
    const res = await fetch(`${GATEWAY}/api/log`);
    const data = await res.json();
    $("row-limit").textContent = data.row_limit;
    renderStats(data.summary);
    renderChart(data.daily);
    renderTable(data.entries);
  } catch (err) {
    $("chart").innerHTML = `<p class="hint">Could not load: ${esc(String(err && err.message ? err.message : err))}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh";
  }
}

$("refresh").addEventListener("click", load);
load();
