import { describe, expect, it, vi, beforeEach } from "vitest";
import { isPlatformAdmin } from "../auth";

/** Brian's verified auth.users id (provisioned platform admin). */
const BRIAN_ID = "e24c3835-4a3e-40db-9774-e186f72444cb";
/** An ordinary authenticated user with no platform_admins row. */
const ORDINARY_ID = "11111111-1111-1111-1111-111111111111";

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    })),
  })),
}));

beforeEach(() => {
  mockGetUser.mockReset();
  mockMaybeSingle.mockReset();
});

describe("isPlatformAdmin()", () => {
  it("returns false for an unauthenticated user (no session)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await isPlatformAdmin();

    expect(result).toBe(false);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    // No DB lookup should happen when there is no session user.
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it("returns false for an ordinary authenticated user with no platform_admins row", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: ORDINARY_ID } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await isPlatformAdmin();

    expect(result).toBe(false);
  });

  it("returns true for the provisioned platform admin (brian@smartflow.co.ke)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: BRIAN_ID } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: BRIAN_ID },
      error: null,
    });

    const result = await isPlatformAdmin();

    expect(result).toBe(true);
  });

  it("returns false when the platform_admins lookup errors", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: BRIAN_ID } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });

    const result = await isPlatformAdmin();

    expect(result).toBe(false);
  });
});
