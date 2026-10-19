import { describe, expect, it, vi, beforeEach } from "vitest";
import { normalizeKEPhone } from "../kenya";

// Storefront checkout is public (no requireMembership).
vi.mock("@/lib/auth", () => ({}));

// Per-table response queues + insert capture
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
  b.select = chain; b.eq = chain; b.neq = chain; b.like = chain;
  b.order = chain; b.limit = chain; b.in = chain; b.update = chain;
  b.insert = (row: unknown) => {
    if (Array.isArray(row)) (inserts[table] ??= []).push(...row);
    else (inserts[table] ??= []).push(row);
    return b;
  };
  b.maybeSingle = () => Promise.resolve(next(table));
  b.single = () => Promise.resolve(next(table));
  b.then = (res: (v: unknown) => void) => Promise.resolve(next(table)).then(res);
  b.select = (f: string) => b;
  b.insert = (row: unknown) => {
    if (Array.isArray(row)) (inserts[table] ??= []).push(...row);
    else (inserts[table] ??= []).push(row);
    return b;
  };
  return b;
}
vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: (t: string) => makeBuilder(t),
    rpc: vi.fn().mockRejectedValue(new Error("rpc not available")), // fallback path → ledger scan
  })),
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimited: () => null }));

import { POST as checkoutPOST } from "@/app/api/storefront/checkout/route";

const SLUG = "mama-mboga";
const BID = "11111111-2222-4333-8444-555555555555";
const PID = "22222222-3333-4444-8555-666666666666";

function productRow(over: Record<string, unknown> = {}) {
  return { id: PID, name: "Soda", selling_price: 100, tax_rate: 0, is_active: true, track_stock: true, ...over };
}
function req(body: unknown) {
  return new Request("http://t/api/storefront/checkout", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const k of Object.keys(inserts)) delete inserts[k];
  setQueues({});
});

describe("normalizeKEPhone", () => {
  it("formats 07XXXXXXXX to +2547XXXXXXXXX", () => {
    expect(normalizeKEPhone("0712345678")).toBe("+254712345678");
  });
  it("rejects invalid phones", () => {
    expect(normalizeKEPhone("123")).toBeNull();
    expect(normalizeKEPhone("")).toBeNull();
  });
});

describe("POST /api/storefront/checkout", () => {
  it("404 for unknown shop slug", async () => {
    setQueues({ businesses: [{ data: null }] });
    const res = await checkoutPOST(req({ business_slug: SLUG, customer_name: "Jane", customer_phone: "0712345678", items: [{ product_id: PID, qty: 1 }] }));
    expect(res.status).toBe(404);
  });

  it("403 for unpublished shop", async () => {
    setQueues({
      businesses: [{ data: { id: BID, slug: SLUG } }],
      storefronts: [{ data: { is_published: false } }],
    });
    const res = await checkoutPOST(req({ business_slug: SLUG, customer_name: "Jane", customer_phone: "0712345678", items: [{ product_id: PID, qty: 1 }] }));
    expect(res.status).toBe(403);
  });

  it("400 when a product is unavailable", async () => {
    setQueues({
      businesses: [{ data: { id: BID, slug: SLUG } }],
      storefronts: [{ data: { is_published: true } }],
      products: [{ data: [] }],
    });
    const res = await checkoutPOST(req({ business_slug: SLUG, customer_name: "Jane", customer_phone: "0712345678", items: [{ product_id: PID, qty: 1 }] }));
    expect(res.status).toBe(400);
  });

  it("400 for invalid phone", async () => {
    setQueues({ businesses: [{ data: { id: BID, slug: SLUG } }] });
    const res = await checkoutPOST(req({ business_slug: SLUG, customer_name: "Jane", customer_phone: "bad", items: [{ product_id: PID, qty: 1 }] }));
    expect(res.status).toBe(400);
  });

  it("happy path: creates customer, order, items, stock movement, audit log", async () => {
    setQueues({
      businesses: [{ data: { id: BID, slug: SLUG } }],
      storefronts: [{ data: { is_published: true, delivery_fee: 0 } }],
      products: [{ data: [productRow()] }],
      stock_movements: [{ data: [{ product_id: PID, quantity_delta: 10 }] }],
      customers: [
        { data: null }, // select (not found)
        { data: { id: "c1" } }, // insert result
      ],
      orders: [{ data: { id: "o1", order_no: "WEB-A1B2C3", business_id: BID, customer_id: "c1", status: "placed", payment_status: "unpaid", subtotal: 200, tax_total: 0, total_due: 200, amount_paid: 0, fulfillment: "pickup", delivery_fee: 0, notes: "" } }, { error: null }],
    });
    const res = await checkoutPOST(req({ business_slug: SLUG, customer_name: "Jane", customer_phone: "0712345678", items: [{ product_id: PID, qty: 2 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_due).toBe(200);
    expect(body.order_no).toMatch(/^WEB-/);

    const order = inserts.orders?.[0] as Record<string, unknown>;
    expect(order.business_id).toBe(BID);
    expect(order.customer_id).toBe("c1");
    expect(order.payment_status).toBe("unpaid");
    expect(order.total_due).toBe(200);

    const items = inserts.order_items as Record<string, unknown>[];
    expect(items[0].unit_price).toBe(100); // server price
    expect(items[0].qty).toBe(2);

    const moves = inserts.stock_movements as Record<string, unknown>[];
    expect(moves[0].quantity_delta).toBe(-2);
    expect(moves[0].idempotency_key).toMatch(/^web-/);

    const audit = inserts.audit_logs?.[0] as Record<string, unknown>;
    expect(audit.action).toBe("order.placed_online");
  });

  it("400 for an inactive product", async () => {
    setQueues({
      businesses: [{ data: { id: BID, slug: SLUG } }],
      storefronts: [{ data: { is_published: true, delivery_fee: 0 } }],
      products: [{ data: [productRow({ is_active: false })] }],
    });
    const res = await checkoutPOST(req({ business_slug: SLUG, customer_name: "Jane", customer_phone: "0712345678", items: [{ product_id: PID, qty: 1 }] }));
    expect(res.status).toBe(400);
    expect(inserts.orders).toBeUndefined();
  });

  it("409 when ledger stock is insufficient (no order written)", async () => {
    setQueues({
      businesses: [{ data: { id: BID, slug: SLUG } }],
      storefronts: [{ data: { is_published: true, delivery_fee: 0 } }],
      products: [{ data: [productRow()] }],
      stock_movements: [{ data: [{ product_id: PID, quantity_delta: 1 }] }],
    });
    const res = await checkoutPOST(req({ business_slug: SLUG, customer_name: "Jane", customer_phone: "0712345678", items: [{ product_id: PID, qty: 2 }] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Insufficient stock/);
    expect(inserts.orders).toBeUndefined();
  });

  it("duplicate client_ref returns the first order without a new insert", async () => {
    setQueues({
      businesses: [{ data: { id: BID, slug: SLUG } }],
      storefronts: [{ data: { is_published: true, delivery_fee: 0 } }],
      products: [{ data: [productRow()] }],
      orders: [{ data: { order_no: "WEB-DUP1", total_due: 200 } }],
    });
    const res = await checkoutPOST(req({ business_slug: SLUG, customer_name: "Jane", customer_phone: "0712345678", items: [{ product_id: PID, qty: 2 }], client_ref: "web-dup-1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.order_no).toBe("WEB-DUP1");
    expect(inserts.orders).toBeUndefined();
  });
});
