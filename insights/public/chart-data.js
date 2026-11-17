/* Pure data helpers for the Insights charts. Dates are the UTC YYYY-MM-DD
 * strings site-logger's timestamps are grouped by. */

/** Every day from `from` to `to` inclusive, so days without visits still get a bar. */
export function dayRange(from, to) {
  const days = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Every YYYY-MM month that the two days span, inclusive. */
export function monthRange(fromDay, toDay) {
  const months = [];
  const cursor = new Date(`${fromDay.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${toDay.slice(0, 7)}-01T00:00:00Z`);
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Pivot {[periodKey], key, n} rows into one { period, counts } per period, in
 * the given order. `key` is the series (a kind or an evidence level). Keys
 * outside `categoryKeys` are dropped, as they have no segment in the chart.
 */
export function pivot(rows, periodKey, periods, categoryKeys) {
  const byPeriod = new Map(
    periods.map((period) => [period, Object.fromEntries(categoryKeys.map((key) => [key, 0]))]),
  );
  for (const row of rows) {
    const counts = byPeriod.get(row[periodKey]);
    if (counts && row.key in counts) counts[row.key] += row.n;
  }
  return periods.map((period) => ({ period, counts: byPeriod.get(period) }));
}

/**
 * Height of one stacked segment, less the gap under it. Any non-zero count
 * keeps a visible height, or small categories would vanish from a tall bar.
 */
export function segmentHeight(n, axisMax, plotHeight, gap, minHeight = 2) {
  return Math.max(minHeight, (n / axisMax) * plotHeight - gap);
}

/** The month logging started in, unless it started on the 1st, and the month still running. */
export function isPartialMonth(month, firstDay, today) {
  if (month === today.slice(0, 7)) return true;
  return month === firstDay.slice(0, 7) && !firstDay.endsWith("-01");
}
