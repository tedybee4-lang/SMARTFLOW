import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

const mockMaybeSingle = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    })),
  })),
}));

import { GET } from "@/app/api/subscriptions/access/route";

const BID = "11111111-2222-3333-4444-555555555555";
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

beforeEach(() => {
  mockRequireMembership.mockReset();
  mockMaybeSingle.mockReset();
  mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "owner" });
});

function req(qs: string) {
  return new Request(`http://test.local/api/subscriptions/access?${qs}`);
}

describe("GET /api/subscriptions/access", () => {
  it("400 without business_id", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
  });

  it("403 for non-member", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await GET(req(`business_id=${BID}`));
    expect(res.status).toBe(403);
  });

  it("active trial reports days left and can_sell", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: "trial",
        trial_started_at: days(-1),
        trial_ends_at: days(6),
        qualifying_sales: 0,
        current_period_start: null,
        current_period_end: null,
        subscription_plans: null,
      },
      error: null,
    });
    const res = await GET(req(`business_id=${BID}`));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.state).toBe("trial");
    expect(j.can_sell).toBe(true);
    expect(j.trial.days_left).toBe(6);
  });

  it("expired trial blocks selling with a reason", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: "trial",
        trial_started_at: days(-10),
        trial_ends_at: days(-3),
        qualifying_sales: 0,
        current_period_start: null,
        current_period_end: null,
        subscription_plans: null,
      },
      error: null,
    });
    const res = await GET(req(`business_id=${BID}`));
    const j = await res.json();
    expect(j.state).toBe("trial_expired");
    expect(j.can_sell).toBe(false);
    expect(j.blocked_reason).toMatch(/trial has ended/i);
  });

  it("no subscription row → state none, legacy access allowed", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(req(`business_id=${BID}`));
    const j = await res.json();
    expect(j.state).toBe("none");
    expect(j.can_sell).toBe(true);
  });

  it("suspended blocks selling", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: "suspended",
        trial_started_at: null,
        trial_ends_at: null,
        qualifying_sales: 0,
        current_period_start: null,
        current_period_end: null,
        subscription_plans: null,
      },
      error: null,
    });
    const res = await GET(req(`business_id=${BID}`));
    const j = await res.json();
    expect(j.can_sell).toBe(false);
    expect(j.blocked_reason).toMatch(/suspended/i);
  });
});
