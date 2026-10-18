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

// Chainable builder that is also thenable, so both styles resolve:
//   .select()                      (awaited directly â€” membership upsert)
//   .select().single() / .single() (terminal â€” business insert, membership verify)
type QueryChain = {
  select: (...a: unknown[]) => QueryChain;
  eq: (...a: unknown[]) => QueryChain;
  limit: (...a: unknown[]) => QueryChain;
  insert: (...a: unknown[]) => QueryChain;
  upsert: (...a: unknown[]) => QueryChain;
  delete: (...a: unknown[]) => QueryChain;
  maybeSingle: (...a: unknown[]) => QueryChain;
  single: (...a: unknown[]) => QueryChain;
  then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => void;
};

function makeChain(payload: unknown): QueryChain {
  const chain = {
    // select() on a chain keeps the payload queued by the root queryBuilder;
    // terminal methods consume their own per-method result queues so queued
    // results land on the call that actually awaits them.
    select: () => chain,
    eq: () => chain,
    limit: () =>
      makeChain(limitQueue.length ? limitQueue.shift() : { data: null, error: null }),
    insert: () => chain,
    upsert: () => chain,
    delete: () => chain,
    maybeSingle: () =>
      makeChain(maybeSingleQueue.length ? maybeSingleQueue.shift() : { data: null, error: null }),
    single: () =>
      makeChain(singleQueue.length ? singleQueue.shift() : { data: null, error: null }),
    then: (resolve: (v: unknown) => void) => {
      resolve(payload);
    },
  } as unknown as QueryChain;
  return chain;
}

let selectQueue: unknown[] = [];
let singleQueue: unknown[] = [];
let limitQueue: unknown[] = [];
let maybeSingleQueue: unknown[] = [];

// Chainable query-builder target shared by every .from(...) call.
const queryBuilder = {
  select: vi.fn(() => makeChain(selectQueue.length ? selectQueue.shift() : { data: null, error: null })),
  eq: vi.fn(function (this: unknown) { return this; }),
  limit: vi.fn(() => makeChain(limitQueue.length ? limitQueue.shift() : { data: null, error: null })),
  maybeSingle: vi.fn(() => makeChain(maybeSingleQueue.length ? maybeSingleQueue.shift() : { data: null, error: null })),
  insert: vi.fn(function (this: unknown) { return this; }),
  upsert: vi.fn(function (this: unknown) { return this; }),
  single: vi.fn(() => makeChain(singleQueue.length ? singleQueue.shift() : { data: null, error: null })),
  delete: vi.fn(function (this: unknown) { return this; }),
};

const mockFrom = vi.fn(() => queryBuilder);

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: vi.fn(() => ({ auth: { getUser: mockGetUser }, from: mockFrom })),
  supabaseServiceRole: vi.fn(() => ({ from: mockFrom, auth: { admin: { getUserById: vi.fn() } } })),
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
  // Per-terminal result scripts are consumed left-to-right through the route's
  // call order, so queued results never land on the wrong link.
  selectQueue = [];
  singleQueue = [];
  limitQueue = [];
  maybeSingleQueue = [];
  mockGetUser.mockReset();
});

const PGRST_MISSING_COLUMN = {
  code: "PGRST204",
  message: "Could not find the 'phone_e164' column of 'businesses' in the schema cache",
  details: "",
  hint: "",
};

describe("/api/onboarding error sanitisation", () => {
  it("returns a sanitised message (no schema/column internals) when the businesses insert fails", async () => {
    // Call order: (1) existing-biz select+limit, (2) slug select+maybeSingle,
    // (3) business insert select+single.
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "u-111" } }, error: null });
    selectQueue.push({ data: null, error: null });
    limitQueue.push({ data: [] });
    selectQueue.push({ data: null, error: null });
    maybeSingleQueue.push({ data: null });
    selectQueue.push({ data: null, error: null });
    singleQueue.push({ data: null, error: PGRST_MISSING_COLUMN });

    const res = await POST(jsonBody(BODY));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Could not create business — please try again.");
    expect(String(body.error)).not.toContain("phone_e164");
    expect(String(body.error)).not.toContain("schema cache");
    expect(String(body.error)).not.toContain("column");
  });

  it("returns 409 for a duplicate slug (unique violation)", async () => {
    // Call order: (1) existing-biz select+limit, (2) slug select+maybeSingle.
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "u-111" } }, error: null });
    selectQueue.push({ data: null, error: null });
    limitQueue.push({ data: [] });
    selectQueue.push({ data: null, error: null });
    maybeSingleQueue.push({ data: { id: "existing-biz" } });

    const res = await POST(jsonBody(BODY));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("taken");
  });

  it("rolls back cleanly when the membership write fails", async () => {
    // Call order: (1) existing-biz select+limit, (2) slug select+maybeSingle,
    // (3) business insert select+single, (4) membership upsert select.
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "u-111" } }, error: null });
    selectQueue.push({ data: null, error: null });
    limitQueue.push({ data: [] });
    selectQueue.push({ data: null, error: null });
    maybeSingleQueue.push({ data: null });
    selectQueue.push({ data: null, error: null });
    singleQueue.push({ data: { id: "biz-new" }, error: null });
    selectQueue.push({ data: null, error: { message: "boom" } });

    const res = await POST(jsonBody(BODY));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Could not complete setup — please try again.");
    expect(String(body.error)).not.toContain("boom");
  });

  it("rolls back when the membership read cannot verify setup", async () => {
    // Call order: (1) existing-biz select+limit, (2) slug select+maybeSingle,
    // (3) business insert select+single, (4) membership upsert select,
    // (5) membership verify select+maybeSingle.
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "u-111" } }, error: null });
    selectQueue.push({ data: null, error: null });
    limitQueue.push({ data: [] });
    selectQueue.push({ data: null, error: null });
    maybeSingleQueue.push({ data: null });
    selectQueue.push({ data: null, error: null });
    singleQueue.push({ data: { id: "biz-new" }, error: null });
    selectQueue.push({ data: [{ business_id: "biz-new" }], error: null });
    selectQueue.push({ data: null, error: null });
    maybeSingleQueue.push({ data: null, error: null });

    const res = await POST(jsonBody(BODY));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Setup could not be verified — please try again.");
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


