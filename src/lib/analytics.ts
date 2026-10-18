/**
 * Pure dashboard analytics helpers — no I/O, unit-testable.
 * Feeds the dashboard's server-rendered SVG charts from real order rows.
 */

const MS_PER_DAY = 86_400_000;

export type DailyTotal = { date: string; label: string; total: number };

/** Date keys for the last `days` days ending today (UTC, YYYY-MM-DD), oldest first. */
export function lastNDays(now: Date, days = 7): Array<{ date: string; label: string }> {
  const out: Array<{ date: string; label: string }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * MS_PER_DAY);
    out.push({
      date: d.toISOString().slice(0, 10),
      label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()],
    });
  }
  return out;
}

/**
 * Bucket order rows into daily totals for the last `days` days.
 * Rows outside the window or unparsable are ignored; days without
 * orders render as 0 so the chart axis stays continuous.
 */
export function aggregateDailySales(
  rows: Array<{ created_at: string; total_due: number | string }>,
  now: Date,
  days = 7,
): DailyTotal[] {
  const window = lastNDays(now, days);
  const byDate = new Map<string, number>(window.map((d) => [d.date, 0]));
  for (const r of rows) {
    const key = String(r.created_at).slice(0, 10);
    if (!byDate.has(key)) continue;
    const v = Number(r.total_due);
    if (!Number.isFinite(v)) continue;
    byDate.set(key, (byDate.get(key) ?? 0) + v);
  }
  return window.map((d) => ({ ...d, total: Math.round((byDate.get(d.date) ?? 0) * 100) / 100 }));
}

export type TopProduct = { name: string; qty: number; revenue: number };

/** Merge order-item rows into top-N products by revenue. */
export function topProducts(
  items: Array<{ name_snapshot: string; qty: number; line_total: number | string }>,
  n = 5,
): TopProduct[] {
  const merged = new Map<string, TopProduct>();
  for (const it of items) {
    const name = it.name_snapshot || "Item";
    const rev = Number(it.line_total);
    const qty = Number(it.qty);
    const cur = merged.get(name) ?? { name, qty: 0, revenue: 0 };
    cur.qty += Number.isFinite(qty) ? qty : 0;
    cur.revenue += Number.isFinite(rev) ? rev : 0;
    merged.set(name, cur);
  }
  return [...merged.values()]
    .map((p) => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, n);
}

/** Percentage change between two periods; null when there is no meaningful base. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
