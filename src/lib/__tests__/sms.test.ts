import { describe, expect, it, vi, beforeEach } from "vitest";
import { smsSegments } from "../messaging";
import { SmsPurchaseSchema, SmsSendSchema } from "../validation";

// ---------------------------------------------------------------------------
// Auth + service-role mocks
// ---------------------------------------------------------------------------
const mockRequireMembership = vi.fn();
const mockIsPlatformAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
  isPlatformAdmin: (...args: unknown[]) => mockIsPlatformAdmin(...args),
}));

const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
// Chainable builder covering the shapes the SMS routes use:
//   .select().eq().eq().eq().order().limit().maybeSingle()
//   .insert().select().single()
//   .update().eq()                       (awaited directly)
const queryBuilder: Record<string, unknown> = {};
Object.assign(queryBuilder, {
  select: vi.fn(function (this: unknown) { return this; }),
  eq: vi.fn(function (this: unknown) { return this; }),
  order: vi.fn(function (this: unknown) { return this; }),
  limit: vi.fn(function (this: unknown) { return this; }),
  update: vi.fn(function (this: unknown) { return this; }),
  insert: vi.fn(function (this: unknown) { return this; }),
  upsert: vi.fn().mockResolvedValue({ error: null }),
  maybeSingle: mockMaybeSingle,
  single: mockSingle,
  then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
});
vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({ from: vi.fn(() => queryBuilder) })),
}));

// No live credentials in tests → mock provider (deterministic).
// Purchase route imports payhero lazily; messaging is imported statically.
import { POST as purchasePOST } from "@/app/api/sms/purchase/route";
import { POST as sendPOST } from "@/app/api/sms/send/route";
import { POST as testPOST } from "@/app/api/sms/test/route";

const BID = "11111111-2222-4333-8444-555555555555";
const PKG = "99999999-8888-4777-a666-555555555555";

function jsonReq(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  mockRequireMembership.mockReset();
  mockIsPlatformAdmin.mockReset();
  mockMaybeSingle.mockReset();
  mockSingle.mockReset();
  mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "owner" });
  mockIsPlatformAdmin.mockResolvedValue(true);
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockSingle.mockResolvedValue({ data: null, error: null });
  delete process.env.TOPSPEED_API_KEY;
  delete process.env.PAYHERO_API_USERNAME;
  delete process.env.PAYHERO_PLATFORM_CHANNEL_ID;
});

describe("smsSegments", () => {
  it("counts 1 segment for short GSM-7 messages", () => {
    expect(smsSegments("Hello")).toBe(1);
  });
  it("uses 153-char concatenation for long GSM-7 messages", () => {
    expect(smsSegments("a".repeat(161))).toBe(2);
  });
  it("halves capacity for unicode (UCS-2) messages", () => {
    expect(smsSegments("a".repeat(71))).toBe(1); // 71 GSM-7 chars fits in 1 segment (≤160)
    expect(smsSegments("😀".repeat(71))).toBe(2); // UCS-2: >70 → ceil(71/67)=2
  });
});

describe("SmsPurchaseSchema", () => {
  it("accepts a valid purchase", () => {
    expect(SmsPurchaseSchema.safeParse({ business_id: BID, package_id: PKG, phone: "0712345678" }).success).toBe(true);
  });
  it("rejects missing package", () => {
    expect(SmsPurchaseSchema.safeParse({ business_id: BID, phone: "0712345678" }).success).toBe(false);
  });
});

describe("SmsSendSchema", () => {
  it("accepts a valid send", () => {
    expect(SmsSendSchema.safeParse({ business_id: BID, to: "0712345678", message: "hi" }).success).toBe(true);
  });
  it("rejects an empty message", () => {
    expect(SmsSendSchema.safeParse({ business_id: BID, to: "0712345678", message: "" }).success).toBe(false);
  });
});

describe("POST /api/sms/purchase", () => {
  it("403 for non-members", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await purchasePOST(jsonReq("http://t/api/sms/purchase", { business_id: BID, package_id: PKG, phone: "0712345678" }));
    expect(res.status).toBe(403);
  });

  it("returns the existing purchase when a recent pending one exists (dedupe)", async () => {
    let calls = 0;
    mockMaybeSingle.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ data: { id: PKG, credits: 4, price_kes: 10 }, error: null }); // package
      return Promise.resolve({ data: { id: "p-old", status: "pending", created_at: new Date().toISOString() }, error: null }); // pending dup
    });
    const res = await purchasePOST(jsonReq("http://t/api/sms/purchase", { business_id: BID, package_id: PKG, phone: "0712345678" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.purchase_id).toBe("p-old");
  });

  it("expires a stale pending purchase so the business can retry", async () => {
    const stale = new Date(Date.now() - 30 * 60_000).toISOString(); // 30 min old
    let calls = 0;
    mockMaybeSingle.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ data: { id: PKG, credits: 4, price_kes: 10 }, error: null });
      if (calls === 2) return Promise.resolve({ data: { id: "p-stale", status: "pending", created_at: stale }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    mockSingle.mockResolvedValueOnce({ data: { id: "p-new" }, error: null });
    // No channel configured → 503 after creating the new purchase (proves the retry proceeded).
    const res = await purchasePOST(jsonReq("http://t/api/sms/purchase", { business_id: BID, package_id: PKG, phone: "0712345678" }));
    expect(res.status).toBe(503);
    expect(queryBuilder.update as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it("503 when no SMS payment channel is configured", async () => {
    let calls = 0;
    mockMaybeSingle.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ data: { id: PKG, credits: 4, price_kes: 10 }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    mockSingle.mockResolvedValue({ data: { id: "p-new" }, error: null });
    const res = await purchasePOST(jsonReq("http://t/api/sms/purchase", { business_id: BID, package_id: PKG, phone: "0712345678" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });
});

describe("POST /api/sms/send", () => {
  it("403 for non-members", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await sendPOST(jsonReq("http://t/api/sms/send", { business_id: BID, to: "0712345678", message: "hi" }));
    expect(res.status).toBe(403);
  });

  it("402 when the credit balance is insufficient", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null }); // no dup + no balance row → 0
    const res = await sendPOST(jsonReq("http://t/api/sms/send", { business_id: BID, to: "0712345678", message: "hi" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.segments_required).toBe(1);
    expect(body.balance).toBe(0);
  });

  it("debits balance and sends with the mock provider (no TOPSPEED key)", async () => {
    let calls = 0;
    mockMaybeSingle.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ data: null, error: null }); // no dup
      return Promise.resolve({ data: { balance: 5 }, error: null }); // enough credits
    });
    mockSingle.mockResolvedValue({ data: { id: "m1" }, error: null });
    const res = await sendPOST(jsonReq("http://t/api/sms/send", { business_id: BID, to: "0712345678", message: "hi" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("sent");
    expect(body.segments_charged).toBe(1);
    expect(body.balance).toBe(4);
  });
});

describe("POST /api/sms/test", () => {
  it("403 for non-admins", async () => {
    mockIsPlatformAdmin.mockResolvedValue(false);
    const res = await testPOST(jsonReq("http://t/api/sms/test", { to: "0712345678", message: "hi" }));
    expect(res.status).toBe(403);
  });

  it("503 when TOPSPEED is not configured", async () => {
    const res = await testPOST(jsonReq("http://t/api/sms/test", { to: "0712345678", message: "hi" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.configured).toBe(false);
  });
});
