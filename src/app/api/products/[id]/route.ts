import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { ProductSchema } from "@/lib/validation";

/**
 * Products: update / delete a single product. RLS already guards access;
 * we additionally require a business membership role server-side and audit
 * every change. Updates are scoped to the caller's business_id so a user
 * cannot retarget another business's product via the URL id.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "Invalid product update" }, { status: 400 });
  }
  const businessId = String(raw.business_id ?? "");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });

  const parsed = ProductSchema.partial().safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid product update" }, { status: 400 });
  // Only apply fields the client actually sent (avoid default-clobbering partial
  // updates); business_id is not a product column.
  const providedKeys = new Set(Object.keys(raw).filter((k) => k !== "business_id"));
  const fields = Object.fromEntries(
    Object.entries(parsed.data ?? {}).filter(([k]) => providedKeys.has(k)),
  );
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Provide at least one field to update" }, { status: 400 });
  }

  const m = await requireMembership(businessId, [
    "owner", "manager", "stockkeeper", "cashier",
  ]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const srv = supabaseServiceRole();
  const { data, error } = await srv
    .from("products")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("business_id", businessId)
    .select("id, name, selling_price")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "Product not found or could not be updated" }, { status: 404 });
  }
  await srv.from("audit_logs").insert({
    business_id: businessId,
    actor_user_id: m.user.id,
    action: "product.update",
    entity: "products",
    entity_id: id,
    after_data: fields,
  });
  return NextResponse.json({ product: data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const { id } = await params;
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });

  const m = await requireMembership(businessId, ["owner", "manager"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const srv = supabaseServiceRole();
  const { error } = await srv.from("products").delete().eq("id", id).eq("business_id", businessId);
  if (error) return NextResponse.json({ error: "Product could not be deleted" }, { status: 404 });
  await srv.from("audit_logs").insert({
    business_id: businessId,
    actor_user_id: m.user.id,
    action: "product.delete",
    entity: "products",
    entity_id: id,
  });
  return NextResponse.json({ ok: true });
}
