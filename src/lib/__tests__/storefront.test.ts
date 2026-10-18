import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

/** Per-table mock queues: each from(table) chain consumes its own result queue. */
type Result = { data: unknown; error: { code?: string } | null };
const queues: Record<string, Result[]> = {};
function take(table: string): Result {
  const q = queues[table] ?? (queues[table] = []);
  return q.length > 0 ? q.shift()! : { data: null, error: null };
}
vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "update", "insert"]) {
        chain[m] = vi.fn(() => chain);
      }
      chain.maybeSingle = vi.fn(async () => take(table));
      return chain;
    }),
  })),
}));

import { GET, POST } from "@/app/api/storefront/route";

const BID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  mockRequireMembership.mockReset();
  mockRequireMembership.mockResolvedValue({ user: { id: "u1" }, role: "owner" });
  for (const k of Object.keys(queues)) delete queues[k];
});

function post(body: unknown) {
  return new Request("http://t/api/storefront", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/storefront (slug management)", () => {
  it("403 for non-owner/manager", async () => {
    mockRequireMembership.mockResolvedValue(null);
    const res = await POST(post({ business_id: BID, slug: "new-shop" }));
    expect(res.status).toBe(403);
  });

  it("400 for reserved slug", async () => {
    const res = await POST(post({ business_id: BID, slug: "dashboard" }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/reserved/i);
  });

  it("400 for malformed slug", async () => {
    const res = await POST(post({ business_id: BID, slug: "Not Valid!" }));
    expect(res.status).toBe(400);
  });

  it("409 when another business already owns the slug", async () => {
    queues.businesses = [{ data: { id: "other-biz" }, error: null }];
    const res = await POST(post({ business_id: BID, slug: "taken-shop" }));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.error).toMatch(/already taken/i);
  });

  it("persists a free slug and returns it", async () => {
    // 1st businesses call: uniqueness pre-check (null = free)
    // storefronts: existing row -> update; businesses 2nd call: update result
    queues.businesses = [
      { data: null, error: null },
      { data: { slug: "my-shop" }, error: null },
    ];
    queues.storefronts = [
      { data: { business_id: BID }, error: null }, // existence check
      { data: { business_id: BID, is_published: true }, error: null }, // update result
    ];
    const res = await POST(post({ business_id: BID, slug: "my-shop", is_published: true }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.slug).toBe("my-shop");
    expect(j.storefront).toMatchObject({ is_published: true });
  });

  it("409 on unique-index race (23505 at update time) without leaking internals", async () => {
    queues.businesses = [
      { data: null, error: null }, // pre-check free
      { data: null, error: { code: "23505" } }, // update loses the race
    ];
    queues.storefronts = [{ data: { business_id: BID }, error: null }];
    const res = await POST(post({ business_id: BID, slug: "raced-shop" }));
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).not.toMatch(/23505|column|schema/i);
  });

  it("saves content without touching the slug when slug is omitted", async () => {
    queues.storefronts = [{ data: { business_id: BID, hero_text: "Karibu!" }, error: null }];
    const res = await POST(post({ business_id: BID, hero_text: "Karibu!" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.slug).toBeNull();
    // no businesses lookup should have happened
    expect(queues.businesses ?? []).toHaveLength(0);
  });
});

describe("GET /api/storefront", () => {
  it("400 without business_id, 403 for non-member", async () => {
    const r1 = await GET(new Request("http://t/api/storefront"));
    expect(r1.status).toBe(400);
    mockRequireMembership.mockResolvedValue(null);
    const r2 = await GET(new Request(`http://t/api/storefront?business_id=${BID}`));
    expect(r2.status).toBe(403);
  });

  it("returns storefront plus the current slug", async () => {
    queues.storefronts = [{ data: { business_id: BID, is_published: true }, error: null }];
    queues.businesses = [{ data: { slug: "my-shop" }, error: null }];
    const res = await GET(new Request(`http://t/api/storefront?business_id=${BID}`));
    const j = await res.json();
    expect(j.slug).toBe("my-shop");
    expect(j.storefront).toMatchObject({ is_published: true });
  });
});
