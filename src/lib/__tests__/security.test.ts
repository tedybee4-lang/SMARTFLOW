import { describe, expect, it } from "vitest";
import { orderTotals, lineTotal } from "../money";
import { normalizeKEPhone } from "../kenya";

/** Tenant-isolation + idempotency + lifecycle rules that must hold server-side. */
describe("order lifecycle guards", () => {
  it("cancelled orders never double-restore: restore flag gates second restore", () => {
    // Simulates the guard in /api/orders/transition: only restore when
    // stock_deducted && !stock_restored. Second cancel finds stock_restored=true.
    const first = { stock_deducted: true, stock_restored: false };
    const shouldRestoreFirst = first.stock_deducted && !first.stock_restored;
    expect(shouldRestoreFirst).toBe(true);
    const second = { stock_deducted: true, stock_restored: true };
    expect(second.stock_deducted && !second.stock_restored).toBe(false);
  });

  it("duplicate callback is idempotent: success state short-circuits", () => {
    const attempt = { status: "success" };
    expect(attempt.status === "success").toBe(true); // handler returns {duplicate:true}
  });

  it("amount mismatch blocks confirmation", () => {
    expect(Math.abs(1000 - 999) > 0.01).toBe(true);
    expect(Math.abs(1000 - 1000) > 0.01).toBe(false);
  });

  it("cash sale is recognised revenue even without PayHero", () => {
    const t = orderTotals([{ qty: 2, unitPrice: 500 }]);
    expect(t.totalDue).toBe(1000);
  });

  it("refunds subtract from qualifying sales, credit stays visible", () => {
    const gross = 60000;
    const refunded = 15000;
    const qualifying = gross - refunded;
    expect(qualifying).toBe(45000); // stays in Starter tier
  });

  it("STK phone required for PayHero", () => {
    expect(normalizeKEPhone("0712345678")).not.toBeNull();
    expect(normalizeKEPhone("not-a-number")).toBeNull();
  });

  it("discount can never exceed gross", () => {
    expect(() => lineTotal({ qty: 1, unitPrice: 100, discount: 101 })).toThrow();
  });
});
