import { NextResponse } from "next/server";
import { getPublicProducts, getPublicShop } from "@/lib/public-storefront";
import { rateLimited } from "@/lib/rate-limit";

/**
 * GET /api/storefront/public?slug=<slug>
 *
 * Public catalogue for the guest cart. The browser cannot read `products`
 * directly (member-scoped RLS), so the catalogue is served from here.
 *
 * Returns ONLY published shops and their ACTIVE products, with public fields
 * only — never cost price, wholesale price, stock levels or tenant ids.
 */
export async function GET(req: Request) {
  const rl = rateLimited(req, 60);
  if (rl) return rl;

  const slug = new URL(req.url).searchParams.get("slug")?.trim().toLowerCase() ?? "";
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  const shop = await getPublicShop(slug);
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const products = await getPublicProducts(shop.business_id);
  return NextResponse.json({
    shop: {
      name: shop.name,
      slug: shop.slug,
      hero_text: shop.hero_text,
      whatsapp_number: shop.whatsapp_number,
      delivery_fee: shop.delivery_fee,
    },
    products,
  });
}
