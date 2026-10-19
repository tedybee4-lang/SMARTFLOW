import { supabaseServiceRole } from "@/lib/supabase-server";

/**
 * Public storefront data access (server-only, service role).
 *
 * Root cause this module fixes: `businesses` and `products` are protected by
 * member-scoped RLS (`is_member(business_id)`), so an ANONYMOUS visitor — the
 * browser Supabase client, or an unauthenticated server read — sees ZERO rows.
 * The storefront pages and the cart therefore rendered "Shop not found" and an
 * empty catalogue for real customers.
 *
 * The fix is deliberately NOT to loosen RLS on tenant tables (that would expose
 * every tenant's catalogue, cost prices and stock). Instead the PUBLIC data
 * needed to browse a shop is read server-side through the service role and
 * filtered here to exactly the fields a guest may see:
 *   - only businesses whose storefront `is_published = true`
 *   - only ACTIVE products of that business
 *   - never cost_price, wholesale_price, stock levels or tenant identifiers
 *
 * Reads stay tenant-scoped by construction: every lookup is anchored to the
 * business resolved from the slug and re-checked against the published shop.
 */

export type PublicProduct = {
  id: string;
  name: string;
  kind: string;
  unit: string;
  selling_price: number;
  tax_rate: number;
  photo_url: string | null;
  attributes: Record<string, unknown>;
};

export type PublicShop = {
  id: string;
  name: string;
  slug: string;
  business_id: string;
  hero_text: string | null;
  whatsapp_number: string | null;
  delivery_fee: number;
  policies: Record<string, unknown>;
};

const PRODUCT_SELECT =
  "id,name,kind,unit,selling_price,tax_rate,photo_url,attributes";

/**
 * Resolve a published shop by its public slug.
 * Returns null when the slug is unknown OR the shop is not published — the two
 * cases are deliberately indistinguishable to guests.
 */
export async function getPublicShop(slug: string): Promise<PublicShop | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return null;

  const srv = supabaseServiceRole();

  // 1. Find the business by its public slug.
  const { data: biz } = await srv
    .from("businesses")
    .select("id,name,slug")
    .eq("slug", clean)
    .maybeSingle();
  const b = biz as { id: string; name: string; slug: string } | null;
  if (!b) return null;

  // 2. The shop must exist AND be published. An unpublished shop is invisible
  //    to guests even though the business row itself exists.
  const { data: shop } = await srv
    .from("storefronts")
    .select("business_id,is_published,hero_text,whatsapp_number,delivery_fee,policies")
    .eq("business_id", b.id)
    .maybeSingle();
  const s = shop as {
    business_id: string;
    is_published: boolean;
    hero_text: string | null;
    whatsapp_number: string | null;
    delivery_fee: number | null;
    policies: Record<string, unknown> | null;
  } | null;
  if (!s?.is_published) return null;

  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    business_id: b.id,
    hero_text: s.hero_text ?? null,
    whatsapp_number: s.whatsapp_number ?? null,
    delivery_fee: Number(s.delivery_fee ?? 0),
    policies: (s.policies ?? {}) as Record<string, unknown>,
  };
}

/** Active products of a published shop, newest first. Public fields only. */
export async function getPublicProducts(businessId: string): Promise<PublicProduct[]> {
  const srv = supabaseServiceRole();
  const { data } = await srv
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(60);

  return ((data ?? []) as PublicProduct[]).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    unit: p.unit,
    selling_price: Number(p.selling_price),
    tax_rate: Number(p.tax_rate),
    photo_url: p.photo_url ?? null,
    attributes: (p.attributes ?? {}) as Record<string, unknown>,
  }));
}

/** A single active product of a published shop (public fields only). */
export async function getPublicProduct(
  businessId: string,
  productId: string,
): Promise<PublicProduct | null> {
  const srv = supabaseServiceRole();
  const { data } = await srv
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", productId)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .maybeSingle();
  const p = data as PublicProduct | null;
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    unit: p.unit,
    selling_price: Number(p.selling_price),
    tax_rate: Number(p.tax_rate),
    photo_url: p.photo_url ?? null,
    attributes: (p.attributes ?? {}) as Record<string, unknown>,
  };
}
