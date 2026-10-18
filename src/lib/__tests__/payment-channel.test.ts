import { describe, expect, it, vi, beforeEach } from "vitest";
import { PaymentChannelSchema } from "../validation";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

const mockUpsert = vi.fn();
const mockMaybeSingle = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
      upsert: mockUpsert,
    })),
  })),
}));

import { GET, PUT } from "@/app/api/business/payment-channel/route";

const BID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  mockRequireMembership.mockReset();
  mockMaybeSingle.mockReset();
  mockUpsert.mockReset();
  mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "owner" });
  mockUpsert.mockResolvedValue({ error: null });
});

describe("PaymentChannelSchema", () => {
  it("accepts a valid till config", () => {
    const r = PaymentChannelSchema.safeParse({ business_id: BID, payment_method: "till", till_number: "8765432" });
    expect(r.success).toBe(true);
  });

  it("accepts a valid paybill config", () => {
    const r = PaymentChannelSchema.safeParse({ business_id: BID, payment_method: "paybill", paybill_number: "400200" });
    expect(r.success).toBe(true);
  });

  it("rejects till method without a numeric number", () => {
    const r = PaymentChannelSchema.safeParse({ business_id: BID, payment_method: "till", till_number: "abc" });
    expect(r.success).toBe(false);
  });

  it("rejects paybill method with an empty number", () => {
    const r = PaymentChannelSchema.safeParse({ business_id: BID, payment_method: "paybill", paybill_number: "" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown payment method", () => {
    const r = PaymentChannelSchema.safeParse({ business_id: BID, payment_method: "crypto" });
    expect(r.success).toBe(false);
  });

  it("rejects payhero without a channel id", () => {
    const r = PaymentChannelSchema.safeParse({ business_id: BID, payment_method: "payhero", channel_id: "" });
    expect(r.success).toBe(false);
  });
});

describe("GET /api/business/payment-channel", () => {
  it("400 without business_id", async () => {
    const res = await GET(new Request("http://t/api/business/payment-channel"));
    expect(res.status).toBe(400);
  });

  it("403 for non-members", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await GET(new Request(`http://t/api/business/payment-channel?business_id=${BID}`));
    expect(res.status).toBe(403);
  });

  it("returns configured settings", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { payment_method: "till", till_number: "8765432", paybill_number: null, channel_id: null, is_active: true },
      error: null,
    });
    const res = await GET(new Request(`http://t/api/business/payment-channel?business_id=${BID}`));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ payment_method: "till", till_number: "8765432", configured: true });
  });

  it("returns unconfigured defaults when no row exists", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(new Request(`http://t/api/business/payment-channel?business_id=${BID}`));
    const j = await res.json();
    expect(j).toMatchObject({ payment_method: null, configured: false, till_number: "" });
  });
});

describe("PUT /api/business/payment-channel", () => {
  function put(body: string) {
    return new Request("http://t/api/business/payment-channel", { method: "PUT", body });
  }

  it("403 for a member who fails the owner/manager role filter", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await PUT(put(JSON.stringify({ business_id: BID, payment_method: "till", till_number: "8765432" })));
    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 on invalid payload", async () => {
    const res = await PUT(put(JSON.stringify({ business_id: BID, payment_method: "till", till_number: "not-a-number" })));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON", async () => {
    const res = await PUT(put("{"));
    expect(res.status).toBe(400);
  });

  it("clears stale targets: only the active method's number is stored", async () => {
    const res = await PUT(
      put(JSON.stringify({
        business_id: BID,
        payment_method: "paybill",
        till_number: "8765432",
        paybill_number: "400200",
        channel_id: "ch-99",
      })),
    );
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = mockUpsert.mock.calls[0];
    expect(payload).toMatchObject({
      business_id: BID,
      payment_method: "paybill",
      till_number: null,
      paybill_number: "400200",
      channel_id: null,
      is_active: true,
    });
    expect(opts).toEqual({ onConflict: "business_id" });
  });

  it("500 without internals when the DB rejects the write", async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'violates check constraint "chk_payment_channel_target"' } });
    const res = await PUT(put(JSON.stringify({ business_id: BID, payment_method: "till", till_number: "8765432" })));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/constraint|chk_payment_channel_target|column/i);
  });
});


