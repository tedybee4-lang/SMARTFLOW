import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Table-aware service-role mock: queues drive SELECT results, inserts/updates
// are recorded so we can assert what was (and was not) written.
// ---------------------------------------------------------------------------
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
const updates: Record<string, { row: unknown; filters: Record<string, unknown> }[]> = {};
const upserts: Record<string, unknown[]> = {};
let idSeq = 0;

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {};
  const filters: Record<string, unknown> = {};
  let pending: { kind: "insert" | "update" | "upsert"; row: unknown } | null = null;
  b.select = () => b;
  b.eq = (col: string, val: unknown) => { filters[col] = val; return b; };
  b.in = () => b;
  b.like = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.insert = (row: unknown) => {
    const rows = Array.isArray(row) ? row : [row];
    (inserts[table] ??= []).push(...rows);
    pending = { kind: "insert", row };
    return b;
  };
  b.upsert = (row: unknown) => {
    const rows = Array.isArray(row) ? row : [row];
    (upserts[table] ??= []).push(...rows);
    pending = { kind: "upsert", row };
    return b;
  };
  b.update = (row: unknown) => { pending = { kind: "update", row }; return b; };
  b.maybeSingle = () => {
    if (pending?.kind === "insert") {
      return Promise.resolve({ data: { ...(pending.row as object), id: `gen-${++idSeq}` }, error: null });
    }
    if (pending) return Promise.resolve({ data: null, error: null });
    return Promise.resolve(next(table));
  };
  b.single = b.maybeSingle;
  b.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => {
    if (pending?.kind === "update") {
      (updates[table] ??= []).push({ row: pending.row, filters: { ...filters } });
      return Promise.resolve({ data: null, error: null }).then(res, rej);
    }
    if (pending) return Promise.resolve({ data: null, error: null }).then(res, rej);
    return Promise.resolve(next(table)).then(res, rej);
  };
  return b;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: (t: string) => makeBuilder(t),
    rpc: vi.fn().mockRejectedValue(new Error("rpc not available")),
  })),
}));

const mockRequireMembership = vi.fn();
const mockIsPlatformAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
  isPlatformAdmin: () => mockIsPlatformAdmin(),
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimited: () => null }));

const mockInitiateSTK = vi.fn(async (args: { reference: string }) => ({
  provider_ref: `MOCK-${args.reference}`,
}));
vi.mock("@/lib/payhero", () => ({
  payheroInitiateSTK: (args: { reference: string }) => mockInitiateSTK(args),
  payheroInitiateSTKReal: vi.fn(),
  payheroConfigStatus: () => ({ configured: true }),
}));

import { POST as stkPOST } from "@/app/api/payments/stk/route";
import { POST as cbPOST } from "@/app/api/payments/payhero-callback/route";

const BIZ = "11111111-2222-4333-8444-555555555555";
const OTHER_BIZ = "99999999-8888-4777-8666-555555555555";
const ORDER = "aaaaaaaa-0000-4000-8000-000000000001";
const INVOICE = "bbbbbbbb-0000-4000-8000-000000000002";
const PURCHASE = "cccccccc-0000-4000-8000-000000000003";

function stkReq(body: unknown) {
  return new Request("http://t/api/payments/stk", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
function cbReq(body: unknown, token = "tok") {
  return new Request("http://t/api/payments/payhero-callback", {
    method: "POST", headers: { "Content-Type": "application/json", "x-payhero-token": token },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const k of Object.keys(inserts)) delete inserts[k];
  for (const k of Object.keys(updates)) delete updates[k];
  for (const k of Object.keys(upserts)) delete upserts[k];
  setQueues({});
  idSeq = 0;
  mockInitiateSTK.mockClear();
  mockRequireMembership.mockReset();
  mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "owner" });
  mockIsPlatformAdmin.mockReset();
  mockIsPlatformAdmin.mockResolvedValue(false);
  process.env.PAYHERO_CALLBACK_TOKEN = "tok";
  delete process.env.PAYHERO_PLATFORM_CHANNEL_ID;
  delete process.env.PAYHERO_SMS_CHANNEL_ID;
});

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: ORDER, business_id: BIZ, total_due: 1000, amount_paid: 0, payment_status: "unpaid", ...over,
});
const invoiceRow = (over: Record<string, unknown> = {}) => ({
  id: INVOICE, business_id: BIZ, amount: 500, status: "unpaid", ...over,
});
const purchaseRow = (over: Record<string, unknown> = {}) => ({
  id: PURCHASE, business_id: BIZ, price_kes: 300, status: "pending", ...over,
});
const businessChannel = (over: Record<string, unknown> = {}) => ({
  provider: "payhero", payment_method: "payhero", channel_id: "CH-BIZ-1", is_active: true, ...over,
});

describe("POST /api/payments/stk - cross-tenant references", () => {
  it("refuses an order belonging to another business (404, no attempt row)", async () => {
    setQueues({
      orders: [{ data: orderRow({ business_id: OTHER_BIZ }) }],
      business_payment_channels: [{ data: businessChannel() }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
    }));
    expect(res.status).toBe(404);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("refuses a subscription invoice belonging to another business", async () => {
    setQueues({ subscription_invoices: [{ data: invoiceRow({ business_id: OTHER_BIZ }) }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "subscription", subscription_invoice_id: INVOICE,
      amount: 500, phone: "0712345678",
    }));
    expect(res.status).toBe(404);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("refuses an SMS purchase belonging to another business", async () => {
    setQueues({ sms_purchases: [{ data: purchaseRow({ business_id: OTHER_BIZ }) }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "sms", sms_purchase_id: PURCHASE, amount: 300, phone: "0712345678",
    }));
    expect(res.status).toBe(404);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("returns 404 (not 403) so other tenants' records are not disclosed", async () => {
    setQueues({ orders: [{ data: orderRow({ business_id: OTHER_BIZ }) }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
    }));
    const body = await res.json();
    expect(body.error).toBe("Payment reference not found.");
    expect(body.error).not.toMatch(/business|tenant|owner/i);
  });
});

describe("POST /api/payments/stk - purpose/reference combinations", () => {
  it("rejects purpose=order without an order_id", async () => {
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", amount: 1000, phone: "0712345678",
    }));
    expect(res.status).toBe(400);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("rejects purpose=order that also carries an invoice id", async () => {
    setQueues({ orders: [{ data: orderRow() }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, subscription_invoice_id: INVOICE,
      amount: 1000, phone: "0712345678",
    }));
    expect(res.status).toBe(400);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("rejects purpose=subscription that carries an order id", async () => {
    setQueues({ subscription_invoices: [{ data: invoiceRow() }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "subscription", subscription_invoice_id: INVOICE, order_id: ORDER,
      amount: 500, phone: "0712345678",
    }));
    expect(res.status).toBe(400);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("rejects purpose=sms that carries an order id", async () => {
    setQueues({ sms_purchases: [{ data: purchaseRow() }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "sms", sms_purchase_id: PURCHASE, order_id: ORDER,
      amount: 300, phone: "0712345678",
    }));
    expect(res.status).toBe(400);
    expect(inserts.payment_attempts).toBeUndefined();
  });
});

describe("POST /api/payments/stk - server-resolved channel", () => {
  it("stores the business channel resolved server-side, not the client's", async () => {
    setQueues({
      orders: [{ data: orderRow() }],
      business_payment_channels: [{ data: businessChannel({ channel_id: "CH-SERVER" }) }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
    }));
    expect(res.status).toBe(201);
    const attempt = inserts.payment_attempts?.[0] as Record<string, unknown>;
    expect(attempt.channel_id).toBe("CH-SERVER");
    expect(attempt.channel_source).toBe("business");
  });

  it("rejects a client channel_id that differs from the resolved channel (409)", async () => {
    setQueues({
      orders: [{ data: orderRow() }],
      business_payment_channels: [{ data: businessChannel({ channel_id: "CH-SERVER" }) }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
      channel_id: "CH-OTHER-TENANT",
    }));
    expect(res.status).toBe(409);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("accepts a client channel_id that matches the resolved channel", async () => {
    setQueues({
      orders: [{ data: orderRow() }],
      business_payment_channels: [{ data: businessChannel({ channel_id: "CH-SERVER" }) }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
      channel_id: "CH-SERVER",
    }));
    expect(res.status).toBe(201);
  });

  it("uses the PLATFORM channel for subscription payments, never the tenant's", async () => {
    process.env.PAYHERO_PLATFORM_CHANNEL_ID = "CH-PLATFORM";
    setQueues({
      subscription_invoices: [{ data: invoiceRow() }],
      business_payment_channels: [{ data: businessChannel({ channel_id: "CH-BIZ-1" }) }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "subscription", subscription_invoice_id: INVOICE,
      amount: 500, phone: "0712345678",
    }));
    expect(res.status).toBe(201);
    const attempt = inserts.payment_attempts?.[0] as Record<string, unknown>;
    expect(attempt.channel_id).toBe("CH-PLATFORM");
    expect(attempt.channel_source).toBe("platform");
  });

  it("uses the platform channel for SMS purchases", async () => {
    process.env.PAYHERO_PLATFORM_CHANNEL_ID = "CH-PLATFORM";
    setQueues({ sms_purchases: [{ data: purchaseRow() }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "sms", sms_purchase_id: PURCHASE, amount: 300, phone: "0712345678",
    }));
    expect(res.status).toBe(201);
    const attempt = inserts.payment_attempts?.[0] as Record<string, unknown>;
    expect(attempt.channel_id).toBe("CH-PLATFORM");
    expect(attempt.channel_source).toBe("platform");
  });

  it("refuses an order payment when the business has no PayHero channel (409)", async () => {
    setQueues({
      orders: [{ data: orderRow() }],
      business_payment_channels: [{ data: businessChannel({ is_active: false }) }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
    }));
    expect(res.status).toBe(409);
    expect(inserts.payment_attempts).toBeUndefined();
  });
});

describe("POST /api/payments/stk - server-derived amount", () => {
  it("rejects a client amount that differs from the amount owed (409)", async () => {
    setQueues({
      orders: [{ data: orderRow() }],
      business_payment_channels: [{ data: businessChannel() }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1, phone: "0712345678",
    }));
    expect(res.status).toBe(409);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("charges the REMAINING balance of a partially paid order", async () => {
    setQueues({
      orders: [{ data: orderRow({ total_due: 1000, amount_paid: 400 }) }],
      business_payment_channels: [{ data: businessChannel() }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 600, phone: "0712345678",
    }));
    expect(res.status).toBe(201);
    const attempt = inserts.payment_attempts?.[0] as Record<string, unknown>;
    expect(attempt.amount).toBe(600);
  });

  it("rejects a client amount equal to the FULL total of a partially paid order", async () => {
    setQueues({
      orders: [{ data: orderRow({ total_due: 1000, amount_paid: 400 }) }],
      business_payment_channels: [{ data: businessChannel() }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
    }));
    expect(res.status).toBe(409);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("refuses a fully paid order (409, already settled)", async () => {
    setQueues({
      orders: [{ data: orderRow({ total_due: 1000, amount_paid: 1000, payment_status: "paid" }) }],
      business_payment_channels: [{ data: businessChannel() }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
    }));
    expect(res.status).toBe(409);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("refuses an already-paid subscription invoice", async () => {
    setQueues({ subscription_invoices: [{ data: invoiceRow({ status: "paid" }) }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "subscription", subscription_invoice_id: INVOICE,
      amount: 500, phone: "0712345678",
    }));
    expect(res.status).toBe(409);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("refuses an already-completed SMS purchase", async () => {
    setQueues({ sms_purchases: [{ data: purchaseRow({ status: "completed" }) }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "sms", sms_purchase_id: PURCHASE, amount: 300, phone: "0712345678",
    }));
    expect(res.status).toBe(409);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("reports 'already settled' even when no channel is configured (409, not 503)", async () => {
    // The settled/amount check must run BEFORE channel resolution, otherwise a
    // missing channel config masks the real reason with a 503.
    setQueues({
      orders: [{ data: orderRow({ total_due: 1000, amount_paid: 1000, payment_status: "paid" }) }],
    });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1000, phone: "0712345678",
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/settled/i);
    expect(inserts.payment_attempts).toBeUndefined();
  });

  it("reports an amount mismatch even when no channel is configured (409, not 503)", async () => {
    setQueues({ orders: [{ data: orderRow() }] });
    const res = await stkPOST(stkReq({
      business_id: BIZ, purpose: "order", order_id: ORDER, amount: 1, phone: "0712345678",
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/mismatch/i);
    expect(inserts.payment_attempts).toBeUndefined();
  });
});

describe("POST /api/payments/payhero-callback - ownership re-check", () => {
  it("refuses to credit an order that no longer belongs to the attempt's business", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-1", business_id: BIZ, order_id: ORDER, subscription_invoice_id: null,
        sms_purchase_id: null, purpose: "order", amount: 1000, status: "initiated", channel_id: "CH-BIZ-1",
      } }],
      orders: [{ data: orderRow({ business_id: OTHER_BIZ }) }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-1", amount: 1000, status: "success" }));
    expect(res.status).toBe(404);
    expect(inserts.payments).toBeUndefined();
    expect(updates.orders).toBeUndefined();
    const attemptUpdate = updates.payment_attempts?.[0]?.row as Record<string, unknown>;
    expect(attemptUpdate.status).toBe("ownership_violation");
  });

  it("refuses to credit a cross-tenant subscription invoice", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-2", business_id: BIZ, order_id: null, subscription_invoice_id: INVOICE,
        sms_purchase_id: null, purpose: "subscription", amount: 500, status: "initiated", channel_id: "CH-PLATFORM",
      } }],
      subscription_invoices: [{ data: invoiceRow({ business_id: OTHER_BIZ }) }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-2", amount: 500, status: "success" }));
    expect(res.status).toBe(404);
    expect(inserts.payments).toBeUndefined();
    expect(updates.subscription_invoices).toBeUndefined();
  });

  it("refuses to credit a cross-tenant SMS purchase", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-3", business_id: BIZ, order_id: null, subscription_invoice_id: null,
        sms_purchase_id: PURCHASE, purpose: "sms", amount: 300, status: "initiated", channel_id: "CH-PLATFORM",
      } }],
      sms_purchases: [{ data: purchaseRow({ business_id: OTHER_BIZ }) }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-3", amount: 300, status: "success" }));
    expect(res.status).toBe(404);
    expect(inserts.sms_ledger).toBeUndefined();
    expect(upserts.sms_balances).toBeUndefined();
  });

  it("refuses a platform attempt that references a tenant entity", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-4", business_id: null, order_id: ORDER, subscription_invoice_id: null,
        sms_purchase_id: null, purpose: "platform", amount: 100, status: "initiated", channel_id: "CH-PLATFORM",
      } }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-4", amount: 100, status: "success" }));
    expect(res.status).toBe(404);
    expect(inserts.payments).toBeUndefined();
  });

  it("credits a same-tenant order and marks it paid", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-5", business_id: BIZ, order_id: ORDER, subscription_invoice_id: null,
        sms_purchase_id: null, purpose: "order", amount: 1000, status: "initiated", channel_id: "CH-BIZ-1",
      } }],
      orders: [{ data: orderRow() }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-5", amount: 1000, status: "success" }));
    expect(res.status).toBe(200);
    const pay = inserts.payments?.[0] as Record<string, unknown>;
    expect(pay.order_id).toBe(ORDER);
    expect(pay.business_id).toBe(BIZ);
    const orderUpdate = updates.orders?.[0]?.row as Record<string, unknown>;
    expect(orderUpdate.amount_paid).toBe(1000);
    expect(orderUpdate.payment_status).toBe("paid");
  });

  it("marks a partially covered order as partial, not paid", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-6", business_id: BIZ, order_id: ORDER, subscription_invoice_id: null,
        sms_purchase_id: null, purpose: "order", amount: 400, status: "initiated", channel_id: "CH-BIZ-1",
      } }],
      orders: [{ data: orderRow({ total_due: 1000, amount_paid: 0 }) }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-6", amount: 400, status: "success" }));
    expect(res.status).toBe(200);
    const orderUpdate = updates.orders?.[0]?.row as Record<string, unknown>;
    expect(orderUpdate.amount_paid).toBe(400);
    expect(orderUpdate.payment_status).toBe("partial");
  });

  it("completes an SMS purchase and credits the SMS balance once", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-7", business_id: BIZ, order_id: null, subscription_invoice_id: null,
        sms_purchase_id: PURCHASE, purpose: "sms", amount: 300, status: "initiated", channel_id: "CH-PLATFORM",
      } }],
      sms_purchases: [{ data: purchaseRow({ credits: 50, status: "pending" }) }],
      sms_balances: [{ data: { balance: 10 } }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-7", amount: 300, status: "success" }));
    expect(res.status).toBe(200);
    const ledger = inserts.sms_ledger?.[0] as Record<string, unknown>;
    expect(ledger.credits).toBe(50);
    expect(ledger.business_id).toBe(BIZ);
    const bal = upserts.sms_balances?.[0] as Record<string, unknown>;
    expect(bal.balance).toBe(60);
  });
});

describe("POST /api/payments/payhero-callback - amount and channel", () => {
  it("rejects an amount that differs from the stored attempt amount", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-8", business_id: BIZ, order_id: ORDER, subscription_invoice_id: null,
        sms_purchase_id: null, purpose: "order", amount: 1000, status: "initiated", channel_id: "CH-BIZ-1",
      } }],
      orders: [{ data: orderRow() }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-8", amount: 500, status: "success" }));
    expect(res.status).toBe(409);
    expect(inserts.payments).toBeUndefined();
    const attemptUpdate = updates.payment_attempts?.[0]?.row as Record<string, unknown>;
    expect(attemptUpdate.status).toBe("amount_mismatch");
  });

  it("rejects a channel that differs from the stored server-resolved channel", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-9", business_id: BIZ, order_id: ORDER, subscription_invoice_id: null,
        sms_purchase_id: null, purpose: "order", amount: 1000, status: "initiated", channel_id: "CH-BIZ-1",
      } }],
      orders: [{ data: orderRow() }],
    });
    const res = await cbPOST(cbReq({
      reference: "ref-9", amount: 1000, status: "success", channel_id: "CH-OTHER-TENANT",
    }));
    expect(res.status).toBe(409);
    expect(inserts.payments).toBeUndefined();
    const attemptUpdate = updates.payment_attempts?.[0]?.row as Record<string, unknown>;
    expect(attemptUpdate.status).toBe("channel_mismatch");
  });

  it("is idempotent: a repeated success credits nothing twice", async () => {
    setQueues({
      payment_attempts: [{ data: {
        id: "att-10", business_id: BIZ, order_id: ORDER, subscription_invoice_id: null,
        sms_purchase_id: null, purpose: "order", amount: 1000, status: "success", channel_id: "CH-BIZ-1",
      } }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-10", amount: 1000, status: "success" }));
    expect(res.status).toBe(200);
    expect(inserts.payments).toBeUndefined();
    expect(updates.orders).toBeUndefined();
  });

  it("requires the callback token", async () => {
    const res = await cbPOST(cbReq({ reference: "ref-11", amount: 1, status: "success" }, "wrong"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown reference", async () => {
    setQueues({ payment_attempts: [{ data: null }] });
    const res = await cbPOST(cbReq({ reference: "nope", amount: 1, status: "success" }));
    expect(res.status).toBe(404);
  });

  it("records a FAILED callback without crediting anything (no ownership read needed)", async () => {
    // A failed provider callback moves no money and touches no tenant entity,
    // so it must still be recorded even if the reference cannot be re-verified.
    setQueues({
      payment_attempts: [{ data: {
        id: "att-12", business_id: BIZ, order_id: ORDER, subscription_invoice_id: null,
        sms_purchase_id: null, purpose: "order", amount: 1000, status: "initiated", channel_id: "CH-BIZ-1",
      } }],
    });
    const res = await cbPOST(cbReq({ reference: "ref-12", amount: 1000, status: "failed" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(inserts.payments).toBeUndefined();
    expect(updates.orders).toBeUndefined();
  });
});
