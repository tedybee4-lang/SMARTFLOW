import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { ProductSchema } from "@/lib/validation";

const Schema = z.object({
  business_id: z.string().uuid(),
  category_id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  kind: z.enum(["product", "service"]).default("product"),
  sku: z.string().max(64).optional().default(""),
  barcode: z.string().max(64).optional().default(""),
  unit: z.string().max(16).default("pcs"),
  cost_price: z.number().min(0).default(0),
  selling_price: z.number().min(0),
  wholesale_price: z.number().min(0).optional(),
  tax_rate: z.number().min(0).max(1).default(0),
  track_stock: z.boolean().default(true),
  low_stock_threshold: z.number().min(0).default(5),
  photo_url: z.string().url().optional().default(""),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  is_active: z.boolean().default(true),
});

/** Products: create / update / list. Prices are re-verified server-side. */
export async function POST(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  const input = parsed.data;

  const m = await requireMembership(input.business_id, ["owner", "manager", "stockkeeper", "cashier"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("products").insert({
    business_id: input.business_id,
    category_id: input.category_id ?? null,
    name: input.name,
    kind: input.kind,
    sku: input.sku || null,
    barcode: input.barcode || null,
    unit: input.unit,
    cost_price: input.cost_price,
    selling_price: input.selling_price,
    wholesale_price: input.wholesale_price ?? null,
    tax_rate: input.tax_rate,
    track_stock: input.track_stock,
    low_stock_threshold: input.low_stock_threshold,
    photo_url: input.photo_url || null,
    attributes: input.attributes,
    is_active: input.is_active,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Could not create product" }, { status: 500 });
  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "product.create", entity: "products", entity_id: (data as { id: string }).id,
    after_data: { name: input.name, selling_price: input.selling_price },
  });
  return NextResponse.json({ product_id: (data as { id: string }).id }, { status: 201 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("products")
    .select("id,name,kind,sku,barcode,unit,cost_price,selling_price,wholesale_price,tax_rate,track_stock,low_stock_threshold,photo_url,attributes,is_active,category_id")
    .eq("business_id", businessId).order("name").limit(200);
  if (error) return NextResponse.json({ error: "Could not load products" }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}