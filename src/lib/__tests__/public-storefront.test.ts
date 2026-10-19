import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression suite for the PUBLIC storefront reader.
 *
 * Root cause: `businesses` and `products` are protected by member-scoped RLS
 * (`is_member(business_id)`), so an anonymous visitor — the browser Supabase
 * client or an unauthenticated server read — saw ZERO rows. Public storefront
 * pages rendered "Shop not found" and the guest cart stayed empty.
 *
 * These tests lock in the fix: the public shop is resolved SERVER-side through
 * the service role, restricted to published shops and active products, and
 * exposes public fields ONLY (never cost price, wholesale price or stock).
 */

/** Per-table response queues: each from(table) chain consumes its own queue. */
type Result = { data: unknown; error?: { code?: string } | null };
const queues: Record<string, Result[]> = {};
function take(table: string): Result {
  const q = queues[table] ?? (queues[table] = []);
  return q.length > 0 ? q.shift()! : { data: null, error: null };
}
/** Records the select columns requested per table so we can assert no leaks. */
const selects: Record<string, string[]> = {};

vi.mock("@/lib/supabase-server", () => ({
  supabaseServiceRole: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn((cols: string) => {
        selects[table] = [...(selects[table] ?? []), cols];
        return chain;
      });
      for (const m of ["eq", "order", "limit"]) chain[m] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => take(table));
      chain.then = (res: (v: unknown) => void) => Promise.resolve(take(table)).then(res);
      return chain;
    }),
  })),
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimited: () => null }));

import { getPublicProduct, getPublicProducts, getPublicShop } from "@/lib/public-storefront";
import { GET as publicGET } from "@/app/api/storefront/public/route";

const BID = "11111111-2222-4333-8444-555555555555";
const SLUG = "mapito-plaza";
const PID = "22222222-3333-4444-8555-666666666666";

function bizRow(over: Record<string, unknown> = {}) {
  return { id: BID, name: "mapito plaza", slug: SLUG, ...over };
}
function shopRow(over: Record<string, unknown> = {}) {
  return {
    business_id: BID,
    is_published: true,
    hero_text: "Karibu",
    whatsapp_number: "+254700000000",
    delivery_fee: 50,
    policies: {},
    ...over,
  };
}
function productRow(over: Record<string, unknown> = {}) {
  return {
    id: PID,
    name: "milk",
    kind: "product",
    unit: "pcs",
    selling_price: 520,
    tax_rate: 0,
    photo_url: null,
    attributes: {},
    ...over,
  };
}

describe("getPublicShop", () => {
  it("returns the shop for a published business", async () => {
    queues.businesses = [{ data: bizRow() }];
    queues.storefronts = [{ data: shopRow() }];
    const shop = await getPublicShop(SLUG);
    expect(shop).not.toBeNull();
    expect(shop!.name).toBe("mapito plaza");
    expect(shop!.business_id).toBe(BID);
    expect(shop!.delivery_fee).toBe(50);
  });

  it("returns null for an unknown slug (no shop row)", async () => {
    queues.businesses = [{ data: null }];
    expect(await getPublicShop("nope")).toBeNull();
  });

  it("returns null when the shop is NOT published", async () => {
    queues.businesses = [{ data: bizRow() }];
    queues.storefronts = [{ data: shopRow({ is_published: false }) }];
    expect(await getPublicShop(SLUG)).toBeNull();
  });

  it("returns null when the business has no storefront row at all", async () => {
    queues.businesses = [{ data: bizRow() }];
    queues.storefronts = [{ data: null }];
    expect(await getPublicShop(SLUG)).toBeNull();
  });

  it("returns null for a blank slug without touching the database", async () => {
    expect(await getPublicShop("   ")).toBeNull();
    expect(queues.businesses ?? []).toHaveLength(0);
  });

  it("does not read tenant-private business columns", async () => {
    queues.businesses = [{ data: bizRow() }];
    queues.storefronts = [{ data: shopRow() }];
    await getPublicShop(SLUG);
    expect(selects.businesses?.join(" ")).not.toMatch(/owner_user_id|email|phone/);
  });
});

describe("getPublicProducts", () => {
  it("returns only active products of the business", async () => {
    queues.products = [{ data: [productRow(), productRow({ id: "p2", name: "rice" })] }];
    const items = await getPublicProducts(BID);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("milk");
    expect(items[0].selling_price).toBe(520);
  });

  it("never selects cost price, wholesale price or stock columns", async () => {
    queues.products = [{ data: [productRow()] }];
    await getPublicProducts(BID);
    const cols = selects.products?.join(" ") ?? "";
    expect(cols).not.toMatch(/cost_price/);
    expect(cols).not.toMatch(/wholesale_price/);
    expect(cols).not.toMatch(/low_stock_threshold/);
    expect(cols).not.toMatch(/business_id/);
  });

  it("returns an empty array when there are no products", async () => {
    queues.products = [{ data: null }];
    expect(await getPublicProducts(BID)).toEqual([]);
  });
});


describe("GET /api/storefront/public", () => {
  it("400 without a slug", async () => {
    const res = await publicGET(new Request("http://t/api/storefront/public"));
    expect(res.status).toBe(400);
  });

  it("404 for an unknown slug", async () => {
    queues.businesses = [{ data: null }];
    const res = await publicGET(new Request("http://t/api/storefront/public?slug=nope"));
    expect(res.status).toBe(404);
  });

  it("404 for an unpublished shop", async () => {
    queues.businesses = [{ data: bizRow() }];
    queues.storefronts = [{ data: shopRow({ is_published: false }) }];
    const res = await publicGET(new Request(`http://t/api/storefront/public?slug=${SLUG}`));
    expect(res.status).toBe(404);
  });

  it("200 with the public catalogue for a published shop", async () => {
    queues.businesses = [{ data: bizRow() }];
    queues.storefronts = [{ data: shopRow() }];
    queues.products = [{ data: [productRow()] }];
    const res = await publicGET(new Request(`http://t/api/storefront/public?slug=${SLUG}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shop.name).toBe("mapito plaza");
    expect(body.shop.delivery_fee).toBe(50);
    expect(body.products).toHaveLength(1);
    expect(body.products[0].name).toBe("milk");
  });

  it("does not leak tenant-private fields into the public payload", async () => {
    queues.businesses = [{ data: bizRow() }];
    queues.storefronts = [{ data: shopRow() }];
    queues.products = [{ data: [productRow()] }];
    const res = await publicGET(new Request(`http://t/api/storefront/public?slug=${SLUG}`));
    const body = await res.json();
    expect(body.products[0]).not.toHaveProperty("cost_price");
    expect(body.products[0]).not.toHaveProperty("business_id");
    expect(body.products[0]).not.toHaveProperty("wholesale_price");
  });
});

describe("getPublicProduct", () => {
  it("returns the product when it belongs to the business", async () => {
    queues.products = [{ data: productRow() }];
    const p = await getPublicProduct(BID, PID);
    expect(p).not.toBeNull();
    expect(p!.id).toBe(PID);
  });

  it("returns null for an unknown product", async () => {
    queues.products = [{ data: null }];
    expect(await getPublicProduct(BID, PID)).toBeNull();
  });
});


beforeEach(() => {
  for (const k of Object.keys(queues)) delete queues[k];
  for (const k of Object.keys(selects)) delete selects[k];
});
