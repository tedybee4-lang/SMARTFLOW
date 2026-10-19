import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/admin/payhero-test authorization + channel-ownership regression tests.
 *
 * The route is platform-admin only, and the PayHero channel it uses is
 * SERVER-resolved (platform channel). A client-supplied channel_id can never
 * redirect the push to another tenant's channel.
 */
const mockIsPlatformAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({
  isPlatformAdmin: () => mockIsPlatformAdmin(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: () => null }));

type StkCall = { amount: number; phone: string; channelId: string; reference: string; callbackUrl: string };
const mockInitiateSTKReal = vi.fn(async (args: StkCall) => ({ provider_ref: `MOCK-${args.channelId}` }));
vi.mock("@/lib/payhero", () => ({
  payheroConfigStatus: () => ({ configured: true }),
  payheroInitiateSTKReal: (args: StkCall) => mockInitiateSTKReal(args),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: () => ({
    from: () => ({
      select: () => ({
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
      insert: async () => ({ data: null, error: null }),
    }),
  }),
}));

vi.mock("@/lib/platform-settings", () => ({
  resolvePlatformChannelId: async () => process.env.PAYHERO_PLATFORM_CHANNEL_ID ?? null,
  resolveSmsChannelId: async () => process.env.PAYHERO_PLATFORM_CHANNEL_ID ?? null,
}));

import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/payhero-test/route";

function adminReq(body: unknown) {
  return new Request("http://t/api/admin/payhero-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockIsPlatformAdmin.mockReset();
  mockInitiateSTKReal.mockClear();
  process.env.PAYHERO_PLATFORM_CHANNEL_ID = "CH-PLATFORM";
});

describe("/api/admin/payhero-test - platform admin gate", () => {
  it("refuses GET to non-platform-admins with 403", async () => {
    mockIsPlatformAdmin.mockResolvedValue(false);
    const res = await adminGET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/admin/i);
  });

  it("refuses POST to non-platform-admins with 403 and sends no STK", async () => {
    mockIsPlatformAdmin.mockResolvedValue(false);
    const res = await adminPOST(adminReq({ phone: "0712345678", amount: 10, confirm_live: true }));
    expect(res.status).toBe(403);
    expect(mockInitiateSTKReal).not.toHaveBeenCalled();
  });
});

describe("/api/admin/payhero-test - server-resolved channel", () => {
  it("uses the server-resolved platform channel for a dry run", async () => {
    mockIsPlatformAdmin.mockResolvedValue(true);
    const res = await adminPOST(adminReq({ phone: "0712345678", amount: 10 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dry_run).toBe(true);
    expect(body.provider_payload.channel_id).toBe("CH-PLATFORM");
    expect(mockInitiateSTKReal).not.toHaveBeenCalled();
  });

  it("refuses a client channel_id that differs from the server-resolved channel (409)", async () => {
    mockIsPlatformAdmin.mockResolvedValue(true);
    const res = await adminPOST(adminReq({
      phone: "0712345678", amount: 10, confirm_live: true, channel_id: "CH-SOMEONE-ELSE",
    }));
    expect(res.status).toBe(409);
    expect(mockInitiateSTKReal).not.toHaveBeenCalled();
  });

  it("sends the live STK on the server channel when a matching hint is supplied", async () => {
    mockIsPlatformAdmin.mockResolvedValue(true);
    const res = await adminPOST(adminReq({
      phone: "0712345678", amount: 10, confirm_live: true, channel_id: "CH-PLATFORM",
    }));
    expect(res.status).toBe(201);
    expect(mockInitiateSTKReal).toHaveBeenCalledTimes(1);
    const arg = mockInitiateSTKReal.mock.calls[0]![0];
    expect(arg.channelId).toBe("CH-PLATFORM");
  });

  it("refuses a live STK above the KSh 20 cap (400)", async () => {
    mockIsPlatformAdmin.mockResolvedValue(true);
    const res = await adminPOST(adminReq({ phone: "0712345678", amount: 500, confirm_live: true }));
    expect(res.status).toBe(400);
    expect(mockInitiateSTKReal).not.toHaveBeenCalled();
  });

  it("reports 503 when no platform channel is configured", async () => {
    mockIsPlatformAdmin.mockResolvedValue(true);
    delete process.env.PAYHERO_PLATFORM_CHANNEL_ID;
    const res = await adminPOST(adminReq({ phone: "0712345678", amount: 10 }));
    expect(res.status).toBe(503);
    expect(mockInitiateSTKReal).not.toHaveBeenCalled();
  });
});
