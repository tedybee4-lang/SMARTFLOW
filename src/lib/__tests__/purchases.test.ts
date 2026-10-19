import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimited: () => null, // tests bypass the limiter
}));

// Table-aware chainable builder: each table has a queue of terminal results.
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
  })),
}));

import { POST as purchasePOST } from "@/app/api/purchases/route";

const BID = "11111111-2222-4333-8444-555555555555";
const OTHER_BID = "99999999-2222-4333-8444-555555555555";
const PID = "22222222-3333-4444-8555-666666666666";
const BRANCH = "33333333-3333-4444-8555-666666666666";
const SUPPLIER = "44444444-3333-4444-8555-666666666666";

function req(body: unknown) {
  return new Request("http://t/api/purchases", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
const body = (over: Record<string, unknown> = {}) => ({
  business_id: BID,
  items: [{ product_id: PID, qty: 5, unit_cost: 20 }],
  ...over,
});

beforeEach(() => {
  mockRequireMembership.mockReset();
  mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "owner" });
  for (const k of Object.keys(inserts)) delete inserts[k];
  setQueues({});
});

describe("POST /api/purchases tenant scoping", () => {
  it("403 for non-members", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await purchasePOST(req(body()));
    expect(res.status).toBe(403);
    expect(inserts.purchase_orders).toBeUndefined();
  });

  it("400 when a product belongs to another business", async () => {
    setQueues({ products: [{ data: [] }] }); // none owned by BID
    const res = await purchasePOST(req(body()));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/do not belong to this business/);
    expect(inserts.purchase_orders).toBeUndefined();
    expect(inserts.stock_movements).toBeUndefined();
  });

  it("400 when the branch belongs to another business", async () => {
    setQueues({
      products: [{ data: [{ id: PID }] }],
      branches: [{ data: null }], // not found for this business
    });
    const res = await purchasePOST(req(body({ branch_id: BRANCH })));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/Branch does not belong/);
    expect(inserts.purchase_orders).toBeUndefined();
  });

  it("400 when the supplier belongs to another business", async () => {
    setQueues({
      products: [{ data: [{ id: PID }] }],
      suppliers: [{ data: null }],
    });
    const res = await purchasePOST(req(body({ supplier_id: SUPPLIER })));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/Supplier does not belong/);
    expect(inserts.purchase_orders).toBeUndefined();
  });

  it("201 creates the PO, stock movements and audit log for owned rows", async () => {
    setQueues({
      products: [{ data: [{ id: PID }] }],
      branches: [{ data: { id: BRANCH } }],
      suppliers: [{ data: { id: SUPPLIER } }],
      purchase_orders: [{ data: { id: "po-1" } }],
    });
    const res = await purchasePOST(req(body({ branch_id: BRANCH, supplier_id: SUPPLIER })));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.purchase_order_id).toBe("po-1");
    expect(j.total).toBe(100);

    const po = inserts.purchase_orders?.[0] as Record<string, unknown>;
    expect(po.business_id).toBe(BID);
    expect(po.branch_id).toBe(BRANCH);
    expect(po.supplier_id).toBe(SUPPLIER);

    const mv = inserts.stock_movements?.[0] as Record<string, unknown>;
    expect(mv.business_id).toBe(BID);
    expect(mv.product_id).toBe(PID);
    expect(mv.quantity_delta).toBe(5);
    expect(mv.idempotency_key).toBe("po-po-1-22222222-3333-4444-8555-666666666666");

    const audit = inserts.audit_logs?.[0] as Record<string, unknown>;
    expect(audit.business_id).toBe(BID);
    expect(audit.action).toBe("purchase.receive");
  });

  it("rejects a payload whose business_id differs from the authorized tenant", async () => {
    setQueues({ products: [{ data: [] }] });
    const res = await purchasePOST(req(body({ business_id: OTHER_BID })));
    expect(res.status).toBe(400);
    expect(inserts.purchase_orders).toBeUndefined();
  });
});
