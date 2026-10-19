import { describe, expect, it, vi, beforeEach } from "vitest";
import { onHandFromMovements } from "../stock";
import { orderTotals } from "../money";
import { CheckoutSchema } from "../validation";

// ---------------------------------------------------------------------------
// Auth + service-role mocks (table-aware chainable builder)
// ---------------------------------------------------------------------------
const mockRequireMembership = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

// Per-table response queues: setQueues({ products: [{data: [...]}], ... })
const queues: Record<string, { data?: unknown; error?: unknown }[]> = {};
function setQueues(q: Record<string, { data?: unknown; error?: unknown }[]>) {
  for (const k of Object.keys(queues)) delete queues[k];
  for (const [k, v] of Object.entries(q)) queues[k] = [...v];
}
function next(table: string) {
  const q = queues[table] ?? [];
  return q.length > 0 ? q.shift()! : { data: null, error: null };
}
const inserts: Record<string, unknown[]> = {};
function makeBuilder(table: string) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = chain; b.eq = chain; b.in = chain; b.like = chain;
  b.order = chain; b.limit = chain; b.update = chain;
  b.insert = (row: unknown) => {
    // Supabase accepts either a single row or an array of rows.
    if (Array.isArray(row)) (inserts[table] ??= []).push(...row);
    else (inserts[table] ??= []).push(row);
    return b;
  };
  b.maybeSingle = () => Promise.resolve(next(table));
  b.single = () => Promise.resolve(next(table));
  b.then = (res: (v: unknown) => void, rej: (e: unknown) => void) =>
    Promise.resolve(next(table)).then(res, rej);
  return b;
}
vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: (t: string) => makeBuilder(t),
    rpc: vi.fn().mockRejectedValue(new Error("rpc not available")), // fallback path → ledger scan
  })),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimited: () => null, // tests bypass the limiter
}));

import { POST as checkoutPOST } from "@/app/api/sales/checkout/route";

const BID = "11111111-2222-4333-8444-555555555555";
const PID = "22222222-3333-4444-8555-666666666666";

function item(over: Record<string, unknown> = {}) {
  return { product_id: PID, qty: 2, unit_price: 100, discount: 0, ...over };
}
function req(body: unknown) {
  return new Request("http://t/api/sales/checkout", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
const catalogRow = (over: Record<string, unknown> = {}) => ({
  id: PID, name: "Soda", selling_price: 100, tax_rate: 0, is_active: true, track_stock: true, ...over,
});

beforeEach(() => {
  mockRequireMembership.mockReset();
  mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "owner" });
  for (const k of Object.keys(inserts)) delete inserts[k];
  setQueues({});
});

describe("onHandFromMovements", () => {
  it("sums deltas per product", () => {
    const m = onHandFromMovements([
      { product_id: "a", quantity_delta: 10 },
      { product_id: "a", quantity_delta: -3 },
      { product_id: "b", quantity_delta: 5 },
    ]);
    expect(m.get("a")).toBe(7);
    expect(m.get("b")).toBe(5);
  });
});

describe("orderTotals", () => {
  it("throws when discount exceeds subtotal (route converts to 400)", () => {
    expect(() => orderTotals([{ qty: 1, unitPrice: 10 }], { orderDiscount: 50 })).toThrow();
  });
});

describe("CheckoutSchema", () => {
  it("accepts a valid sale with client_ref", () => {
    expect(CheckoutSchema.safeParse({ business_id: BID, items: [item()], payment_method: "cash", amount_paid: 200, client_ref: "pos-abc12345" }).success).toBe(true);
  });
  it("rejects an unsafe client_ref (LIKE-injection characters)", () => {
    expect(CheckoutSchema.safeParse({ business_id: BID, items: [item()], payment_method: "cash", client_ref: "ab%cd_ef" }).success).toBe(false);
  });
  it("rejects empty items", () => {
    expect(CheckoutSchema.safeParse({ business_id: BID, items: [], payment_method: "cash" }).success).toBe(false);
  });
});

describe("POST /api/sales/checkout", () => {
  it("403 for non-members", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], payment_method: "cash", amount_paid: 200 }));
    expect(res.status).toBe(403);
  });

  it("403 when a cashier applies a discount", async () => {
    mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "cashier" });
    const res = await checkoutPOST(req({ business_id: BID, items: [item({ discount: 10 })], payment_method: "cash", amount_paid: 190 }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/discount/i);
  });

  it("400 when order discount exceeds subtotal (no 500, nothing written)", async () => {
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], order_discount: 999, payment_method: "cash", amount_paid: 0 }));
    expect(res.status).toBe(400);
    expect(inserts.orders).toBeUndefined();
  });

  it("409 on price tampering before writing the order", async () => {
    setQueues({ products: [{ data: [catalogRow()] }] });
    const res = await checkoutPOST(req({ business_id: BID, items: [item({ unit_price: 1 })], payment_method: "cash", amount_paid: 2 }));
    expect(res.status).toBe(409);
    expect(inserts.orders).toBeUndefined();
  });

  it("400 when a product is unknown (no orphan order)", async () => {
    setQueues({ products: [{ data: [] }] });
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], payment_method: "cash", amount_paid: 200 }));
    expect(res.status).toBe(400);
    expect(inserts.orders).toBeUndefined();
  });

  it("409 when stock is insufficient (ledger-checked, no order written)", async () => {
    setQueues({
      products: [{ data: [catalogRow()] }],
      stock_movements: [{ data: [{ product_id: PID, quantity_delta: 1 }] }],
    });
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], payment_method: "cash", amount_paid: 200 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Insufficient stock/);
    expect(inserts.orders).toBeUndefined();
  });

  it("returns the first order for a duplicate client_ref (idempotent retry)", async () => {
    setQueues({ orders: [{ data: { id: "ord-1", order_no: "ORD-X", payment_status: "paid", total_due: 200 } }] });
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], payment_method: "cash", amount_paid: 200, client_ref: "pos-dup-1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.order_id).toBe("ord-1");
    expect(inserts.orders).toBeUndefined();
  });

  it("happy path: paid cash order, server-price snapshots, stock movement", async () => {
    setQueues({
      orders: [{ data: { id: "ord-3" } }],
      products: [{ data: [catalogRow()] }],
      stock_movements: [{ data: [{ product_id: PID, quantity_delta: 10 }] }],
    });
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], payment_method: "cash", amount_paid: 200 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalDue).toBe(200);
    expect(body.payment_status).toBe("paid");
    expect(body.await_payment).toBe(false);
    const orderRow = inserts.orders?.[0] as Record<string, unknown>;
    expect(orderRow.payment_status).toBe("paid");
    expect(orderRow.status).toBe("processing");
    const items = inserts.order_items as Record<string, unknown>[];
    expect(items[0].unit_price).toBe(100); // server price snapshot, not client echo
    const moves = inserts.stock_movements as Record<string, unknown>[];
    expect(moves[0].quantity_delta).toBe(-2);
  });

  it("payhero sale: payment_pending/unpaid, no payment row, stock reserved", async () => {
    setQueues({
      orders: [{ data: { id: "ord-4" } }],
      products: [{ data: [catalogRow()] }],
      stock_movements: [{ data: [{ product_id: PID, quantity_delta: 10 }] }],
    });
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], payment_method: "payhero", amount_paid: 0 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.await_payment).toBe(true);
    expect(body.payment_status).toBe("unpaid");
    const orderRow = inserts.orders?.[0] as Record<string, unknown>;
    expect(orderRow.status).toBe("payment_pending");
    expect(inserts.payments).toBeUndefined();
    expect(inserts.stock_movements).toBeDefined();
  });

  it("402 when the trial has expired", async () => {
    setQueues({
      subscriptions: [{ data: { status: "trial", trial_started_at: "2026-01-01T00:00:00Z", trial_ends_at: "2026-01-08T00:00:00Z", current_period_start: null, current_period_end: null } }],
    });
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], payment_method: "cash", amount_paid: 200 }));
    expect(res.status).toBe(402);
    expect(inserts.orders).toBeUndefined();
  });

  it("skips stock movement for non-tracked products (services)", async () => {
    setQueues({
      orders: [{ data: { id: "ord-5" } }],
      products: [{ data: [catalogRow({ track_stock: false, name: "Haircut" })] }],
    });
    const res = await checkoutPOST(req({ business_id: BID, items: [item()], payment_method: "cash", amount_paid: 200 }));
    expect(res.status).toBe(200);
    expect(inserts.stock_movements).toBeUndefined();
  });
});

