import { describe, expect, it } from "vitest";
import { lastNDays, aggregateDailySales, topProducts, pctChange } from "../analytics";

const NOW = new Date("2026-10-18T15:00:00.000Z"); // Sunday
const iso = (daysAgo: number, hour = 10) =>
  new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10) + `T${hour.toString().padStart(2, "0")}:00:00.000Z`;

describe("lastNDays", () => {
  it("returns 7 consecutive days ending today, oldest first", () => {
    const days = lastNDays(NOW, 7);
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe("2026-10-18");
    expect(days[0].date).toBe("2026-10-12");
    expect(days.map((d) => d.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("aggregateDailySales", () => {
  it("buckets rows by day and zeroes empty days", () => {
    const rows = [
      { created_at: iso(0), total_due: 1500 },
      { created_at: iso(0), total_due: 500 },   // same day sums
      { created_at: iso(3), total_due: "200.5" }, // string numbers supported
      { created_at: iso(10), total_due: 999 },  // outside window ignored
    ];
    const out = aggregateDailySales(rows, NOW, 7);
    expect(out).toHaveLength(7);
    expect(out[6].total).toBe(2000);      // today
    expect(out[3].total).toBe(200.5);     // 3 days ago
    expect(out[0].total).toBe(0);         // empty day
    expect(out[5].total).toBe(0);
  });

  it("ignores non-finite totals", () => {
    const out = aggregateDailySales([{ created_at: iso(0), total_due: NaN }], NOW, 7);
    expect(out[6].total).toBe(0);
  });

  it("handles an empty order set", () => {
    const out = aggregateDailySales([], NOW, 7);
    expect(out.every((d) => d.total === 0)).toBe(true);
  });

  it("rounds to 2 decimal places", () => {
    const out = aggregateDailySales([{ created_at: iso(1), total_due: 10.006 }], NOW, 7);
    const day = out.find((d) => d.date === iso(1).slice(0, 10))!;
    expect(day.total).toBe(10.01);
  });
});

describe("topProducts", () => {
  it("merges rows with the same name and sorts by revenue", () => {
    const out = topProducts([
      { name_snapshot: "Bread", qty: 2, line_total: 200 },
      { name_snapshot: "Milk", qty: 1, line_total: 350 },
      { name_snapshot: "Bread", qty: 1, line_total: 100 },
    ], 5);
    expect(out[0]).toEqual({ name: "Milk", qty: 1, revenue: 350 });
    expect(out[1]).toEqual({ name: "Bread", qty: 3, revenue: 300 });
    expect(out).toHaveLength(2);
  });

  it("respects the limit and falls back to a generic name for blanks", () => {
    const out = topProducts(
      Array.from({ length: 8 }, (_, i) => ({ name_snapshot: i === 7 ? "" : `P${i}`, qty: 1, line_total: i })),
      3,
    );
    expect(out).toHaveLength(3);
    expect(out[0].name).toBe("Item"); // blank row (highest revenue) renamed
    expect(out[0].revenue).toBe(7);
    expect(out.map((p) => p.name)).toContain("P6");
    expect(out.map((p) => p.name)).not.toContain("P4"); // outside top 3
  });
});

describe("pctChange", () => {
  it("computes growth from a positive base", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
  });
  it("treats any sales over zero-base as +100, both-zero as 0", () => {
    expect(pctChange(10, 0)).toBe(100);
    expect(pctChange(0, 0)).toBe(0);
  });
  it("returns null for invalid numbers", () => {
    expect(pctChange(NaN, 10)).toBeNull();
    expect(pctChange(10, Infinity)).toBeNull();
  });
});
