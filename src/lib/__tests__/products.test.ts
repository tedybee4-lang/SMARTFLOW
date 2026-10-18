import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

const mockSingle = vi.fn();
const mockInsert = vi.fn();
let terminal: { data: unknown; error: unknown } = { data: null, error: null };
const queryBuilder: Record<string, unknown> = {
  select: vi.fn(function (this: unknown) { return this; }),
  eq: vi.fn(function (this: unknown) { return this; }),
  update: vi.fn(function (this: unknown) { return this; }),
  delete: vi.fn(function (this: unknown) { return this; }),
  insert: mockInsert,
  single: mockSingle,
  then: (resolve: (v: unknown) => void) => resolve(terminal),
};

vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: vi.fn(() => queryBuilder),
  })),
}));

import { PUT, DELETE } from "@/app/api/products/[id]/route";

const BID = "11111111-2222-4333-8444-555555555555";
const PID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";

beforeEach(() => {
  mockRequireMembership.mockReset();
  mockSingle.mockReset();
  mockInsert.mockReset();
  terminal = { data: null, error: null };
  mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "owner" });
  mockSingle.mockResolvedValue({ data: { id: PID, name: "Existing", selling_price: 100 }, error: null });
  mockInsert.mockResolvedValue({ error: null });
});

function put(body: unknown) {
  return new Request(`http://t/api/products/${PID}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/products/:id", () => {
  it("403 when the caller lacks a business role", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await PUT(put({ business_id: BID, name: "X" }), { params: Promise.resolve({ id: PID }) });
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("400 on an invalid / empty update", async () => {
    const res = await PUT(put({ business_id: BID }), { params: Promise.resolve({ id: PID }) }); // nothing to update
    expect(res.status).toBe(400);
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON", async () => {
    const res = await PUT(new Request(`http://t/api/products/${PID}`, {
      method: "PUT", body: "{",
    }), { params: Promise.resolve({ id: PID }) });
    expect(res.status).toBe(400);
  });

  it("scopes the update to the caller's business and audits it", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: PID, name: "Renamed", selling_price: 250 },
      error: null,
    });
    const res = await PUT(put({ business_id: BID, name: "Renamed", selling_price: 250 }), { params: Promise.resolve({ id: PID }) });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.product.name).toBe("Renamed");
    expect(mockSingle).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [audit] = mockInsert.mock.calls[0];
    expect(audit).toMatchObject({
      business_id: BID,
      action: "product.update",
      entity: "products",
      entity_id: PID,
    });
  });

  it("404 when no matching product exists", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const res = await PUT(put({ business_id: BID, name: "Renamed" }), { params: Promise.resolve({ id: PID }) });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/products/:id", () => {
  async function del(bid: string | null) {
    const url = bid ? `http://t/api/products/${PID}?business_id=${encodeURIComponent(bid)}` : `http://t/api/products/${PID}`;
    return DELETE(new Request(url, { method: "DELETE" }), { params: Promise.resolve({ id: PID }) });
  }

  it("400 without business_id", async () => {
    const res = await del(null);
    expect(res.status).toBe(400);
  });

  it("403 for non-owner/manager", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await del(BID);
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("200 and audits the deletion", async () => {
    terminal = { data: null, error: null };
    const res = await del(BID);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [audit] = mockInsert.mock.calls[0];
    expect(audit).toMatchObject({
      business_id: BID,
      action: "product.delete",
      entity: "products",
      entity_id: PID,
    });
  });

  it("404 when the delete fails", async () => {
    terminal = { data: null, error: { message: "gone" } };
    const res = await del(BID);
    expect(res.status).toBe(404);
  });
});

