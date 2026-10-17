import { describe, expect, it } from "vitest";
import { normalizeKEPhone, toSTKFormat, formatKES } from "../kenya";
import { lineTotal, orderTotals, tierFeeForSales } from "../money";

describe("kenya helpers", () => {
  it("normalises 07/01/+254 formats", () => {
    expect(normalizeKEPhone("0712345678")).toBe("+254712345678");
    expect(normalizeKEPhone("0112345678")).toBe("+254112345678");
    expect(normalizeKEPhone("+254712345678")).toBe("+254712345678");
    expect(normalizeKEPhone("254712345678")).toBe("+254712345678");
    expect(normalizeKEPhone("123")).toBeNull();
  });
  it("builds STK format", () => {
    expect(toSTKFormat("0712345678")).toBe("254712345678");
  });
  it("formats KES", () => {
    expect(formatKES(1250)).toBe("KSh 1,250.00");
  });
});

describe("sale math", () => {
  it("computes line totals with discount", () => {
    expect(lineTotal({ qty: 2, unitPrice: 500, discount: 100 })).toBe(900);
  });
  it("rejects discount above gross", () => {
    expect(() => lineTotal({ qty: 1, unitPrice: 100, discount: 200 })).toThrow();
  });
  it("computes order totals with tax", () => {
    const t = orderTotals(
      [{ qty: 2, unitPrice: 500 }, { qty: 1, unitPrice: 300, discount: 50 }],
      { taxRate: 0.16 },
    );
    expect(t.subtotal).toBe(1300);
    expect(t.discountTotal).toBe(50);
    expect(t.taxTotal).toBe(200);
    expect(t.totalDue).toBe(1450);
  });
  it("cash sale without tax works", () => {
    const t = orderTotals([{ qty: 1, unitPrice: 250 }]);
    expect(t.totalDue).toBe(250);
  });
});

describe("subscription tiers", () => {
  it("maps starting tier 0-50k to 4000", () => {
    expect(tierFeeForSales(0)).toBe(4000);
    expect(tierFeeForSales(50_000)).toBe(4000);
    expect(tierFeeForSales(50_001)).toBe(6000);
    expect(tierFeeForSales(1_000_000)).toBe(12000);
    expect(tierFeeForSales(5_000_000)).toBe(-1);
  });
});
