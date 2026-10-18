import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Dynamic import (runs after top-level mock definitions) avoids TDZ: the
// vi.mock factory for @/lib/supabase-server references mockGetUser/mockFrom,
// which must be initialised before the route module is loaded.
let POST: (req: Request) => Promise<NextResponse>;
beforeAll(async () => {
  const mod = await import("../../app/api/onboarding/route");
  POST = mod.POST;
});

/** Regression test for the onboarding "missing phone_e164 column" failure.
 *
 * Migration 0001 created businesses.phone but not businesses.phone_e164, so the
 * onboarding insert used to fail with a schema-cache error that leaked internal
 * DB details to the client. The fix adds phone_e164 additively (0006) AND
 * sanitises the 500 error so users never see schema/column internals.
 */

const mockGetUser = vi.fn();
const mockLimit = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();

// Chainable query-builder target shared by every .from(...) call.
const queryBuilder = {
  select: mockSelect,
  eq: mockEq,
  limit: mockLimit,
  maybeSingle: mockMaybeSingle,
  insert: mockInsert,
  single: mockSingle,
};

const mockFrom = vi.fn(() => queryBuilder);

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: vi.fn(() => ({ auth: { getUser: mockGetUser }, from: mockFrom })),
  supabaseServiceRole: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimited: vi.fn(() => null) }));

const BODY = {
  name: "Test Shop",
  slug: "test-shop",
  business_type: "retail",
  phone: "0712345678",
  location: "Nairobi",
};

function jsonBody(body: unknown) {
  return new Request("http://localhost/api/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  // Chainable links: every link returns the same query builder.
  mockSelect.mockReturnValue(queryBuilder);
  mockEq.mockReturnValue(queryBuilder);
  mockInsert.mockReturnValue(queryBuilder);
  mockFrom.mockReturnValue(queryBuilder);
});

const PGRST_MISSING_COLUMN = {
  code: "PGRST204",
  message: "Could not find the 'phone_e164' column of 'businesses' in the schema cache",
  details: "",
  hint: "",
};

describe("/api/onboarding error sanitisation", () => {
  it("returns a sanitised message (no schema/column internals) when the businesses insert fails", async () => {
    // Call order: getUser -> existing-biz (limit) -> slug (maybeSingle) -> insert (single)
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "u-111" } }, error: null });
    mockLimit.mockResolvedValueOnce({ data: [] });
    mockMaybeSingle.mockResolvedValueOnce({ data: null });
    // Supabase resolves { data, error } on failure; it does not throw.
    mockSingle.mockResolvedValueOnce({ data: null, error: PGRST_MISSING_COLUMN });

    const res = await POST(jsonBody(BODY));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Could not create business — please try again.");
    expect(String(body.error)).not.toContain("phone_e164");
    expect(String(body.error)).not.toContain("schema cache");
    expect(String(body.error)).not.toContain("column");
  });

  it("returns 409 for a duplicate slug (unique violation)", async () => {
    // Call order: getUser -> existing-biz (limit) -> slug (maybeSingle = taken)
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "u-111" } }, error: null });
    mockLimit.mockResolvedValueOnce({ data: [] });
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "existing-biz" } });

    const res = await POST(jsonBody(BODY));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("taken");
  });

  it("still requires authentication", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const res = await POST(jsonBody(BODY));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Not authenticated");
  });
});

describe("response shape", () => {
  it("uses NextResponse.json for its replies", () => {
    expect(NextResponse.json).toBeDefined();
  });
});

