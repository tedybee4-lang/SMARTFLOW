import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// PayHero callback idempotency + token verification
// ---------------------------------------------------------------------------
let callbackPOST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  const mod = await import("@/app/api/payments/payhero-callback/route");
  callbackPOST = mod.POST;
});

const mockMaybeSingle = vi.fn();

// Chainable, thenable builder: route calls like
//   .update({...}).eq("id", ...)   (awaited directly)
//   .insert({...})                 (awaited directly)
//   .select("*").eq(...).maybeSingle()  (terminal)
// must all work; non-terminal awaits resolve to a no-op result.
const queryBuilder: Record<string, unknown> = {};
Object.assign(queryBuilder, {
  select: vi.fn(function (this: unknown) { return this; }),
  eq: vi.fn(function (this: unknown) { return this; }),
  update: vi.fn(function (this: unknown) { return this; }),
  insert: vi.fn(function (this: unknown) { return this; }),
  maybeSingle: mockMaybeSingle,
  then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: vi.fn(() => queryBuilder),
  })),
}));

beforeEach(() => {
  mockMaybeSingle.mockReset();
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
});

function cbReq(body: unknown, token: string | null = null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-payhero-token"] = token;
  return new Request("http://localhost/api/payments/payhero-callback", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/payments/payhero-callback", () => {
  it("rejects callbacks without the configured token", async () => {
    const res = await callbackPOST(cbReq({ reference: "x" }));
    expect(res.status).toBe(401);
  });

  it("is idempotent: a second success after the first is a no-op", async () => {
    process.env.PAYHERO_CALLBACK_TOKEN = "tok";
    // First callback: attempt exists, not yet successful.
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "a1",
        business_id: "b",
        order_id: "o",
        subscription_invoice_id: null,
        purpose: "order",
        amount: 100,
        status: "initiated",
        channel_id: "ch",
      },
      error: null,
    });
    const first = await callbackPOST(
      cbReq({ reference: "ref-1", amount: 100, status: "success", provider_ref: "pr-1" }, "tok")
    );
    expect(first.status).toBe(200);

    // Second callback: attempt already success -> duplicate short-circuit.
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "a1",
        business_id: "b",
        order_id: "o",
        subscription_invoice_id: null,
        purpose: "order",
        amount: 100,
        status: "success",
        channel_id: "ch",
      },
      error: null,
    });
    const second = await callbackPOST(
      cbReq({ reference: "ref-1", amount: 100, status: "success", provider_ref: "pr-1" }, "tok")
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.duplicate).toBe(true);
  });

  it("records amount_mismatch when amounts differ", async () => {
    process.env.PAYHERO_CALLBACK_TOKEN = "tok";
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "a1",
        business_id: "b",
        order_id: null,
        subscription_invoice_id: null,
        purpose: "subscription",
        amount: 500,
        status: "initiated",
        channel_id: "ch",
      },
      error: null,
    });
    const res = await callbackPOST(
      cbReq({ reference: "ref-2", amount: 499, status: "success" }, "tok")
    );
    expect(res.status).toBe(409);
  });

  it("marks the attempt failed when the provider reports failure", async () => {
    process.env.PAYHERO_CALLBACK_TOKEN = "tok";
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "a1",
        business_id: "b",
        order_id: null,
        subscription_invoice_id: null,
        purpose: "subscription",
        amount: 100,
        status: "initiated",
        channel_id: "ch",
      },
      error: null,
    });
    const res = await callbackPOST(
      cbReq({ reference: "ref-3", amount: 100, status: "failed" }, "tok")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
  });
});
