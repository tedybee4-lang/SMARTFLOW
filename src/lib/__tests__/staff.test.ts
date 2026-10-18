import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { NextResponse } from "next/server";

let staffPOST: (req: Request) => Promise<NextResponse>;
let staffGET: (req: Request) => Promise<NextResponse>;
beforeAll(async () => {
  const mod = await import("@/app/api/staff/route");
  staffPOST = mod.POST;
  staffGET = mod.GET;
});

const BIZ = "a1a1a1a1-2b2b-3c3c-8d8d-5e5e5e5e5e5e";
const ACTOR = "b2b2b2b2-3c3c-4d4d-9e9e-6f6f6f6f6f6f";
const TARGET = "c3c3c3c3-4d4d-5e5e-8a7a-7a7a7a7a7a7a";

// Declared before vi.mock (hoisting) so the factory can reference them.
const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockOrder = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      order: mockOrder,
      maybeSingle: mockMaybeSingle,
    })),
  })),
  supabaseServiceRole: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      order: mockOrder,
      maybeSingle: mockMaybeSingle,
    })),
  })),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: vi.fn(() => null) }));

const authUser = (id: string) => ({ data: { user: { id } }, error: null });
const authNone = () => ({ data: { user: null }, error: null });

function req(body: unknown) {
  return new Request("http://localhost/api/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(search: string) {
  return new Request("http://localhost/api/staff?" + search);
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockMaybeSingle.mockReset();
  mockInsert.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockOrder.mockReset();
  mockInsert.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() });
  mockUpdate.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() });
  mockDelete.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() });
  mockOrder.mockResolvedValue({ data: [], error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  // Default: no session. The route calls getUser twice (explicit check +
  // requireMembership), so a persistent default covers both.
  mockGetUser.mockResolvedValue(authNone());
});

describe("POST /api/staff", () => {
  it("rejects unauthenticated callers", async () => {
    const res = await staffPOST(req({ business_id: BIZ, user_id: TARGET, role: "cashier", action: "add" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-members of the business", async () => {
    mockGetUser.mockResolvedValue(authUser(ACTOR));
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await staffPOST(req({ business_id: BIZ, user_id: TARGET, role: "cashier", action: "add" }));
    expect(res.status).toBe(403);
  });

  it("allows a manager to add a cashier", async () => {
    mockGetUser.mockResolvedValue(authUser(ACTOR));
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: "manager" }, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "m1" }, error: null });
    const res = await staffPOST(req({ business_id: BIZ, user_id: TARGET, role: "cashier", action: "add" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects a cashier trying to add staff", async () => {
    mockGetUser.mockResolvedValue(authUser(ACTOR));
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: "cashier" }, error: null });
    const res = await staffPOST(req({ business_id: BIZ, user_id: TARGET, role: "cashier", action: "add" }));
    expect(res.status).toBe(403);
  });

  it("rejects invalid roles (no platform-admin smuggling)", async () => {
    mockGetUser.mockResolvedValue(authUser(ACTOR));
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: "owner" }, error: null });
    const res = await staffPOST(req({ business_id: BIZ, user_id: TARGET, role: "platform_admin", action: "add" }));
    expect(res.status).toBe(400);
  });

  it("prevents self-removal", async () => {
    mockGetUser.mockResolvedValue(authUser(ACTOR));
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: "owner" }, error: null });
    const res = await staffPOST(req({ business_id: BIZ, user_id: ACTOR, role: "owner", action: "remove" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/staff", () => {
  it("returns members for a member", async () => {
    mockGetUser.mockResolvedValue(authUser(ACTOR));
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: "owner" }, error: null });
    mockOrder.mockResolvedValueOnce({ data: [{ user_id: ACTOR, role: "owner" }], error: null });
    const res = await staffGET(getReq("business_id=" + BIZ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(1);
  });
});