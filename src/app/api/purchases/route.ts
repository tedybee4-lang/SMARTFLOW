import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";

const Schema = z.object({
  business_id: z.string().uuid(),
  supplier_id: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    qty: z.number().positive(),
    unit_cost: z.number().min(0),
  })).min(1),
  notes: z.string().max(500).optional().default(""),
});

/** Purchase orders: create draft + receive goods (stock ledger). */
export async function POST(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid purchase order" }, { status: 400 });
  const input = parsed.data;
  const m = await requireMembership(input.business_id, ["owner", "manager", "stockkeeper"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const srv = supabaseServiceRole();
  const total = input.items.reduce((s, i) => s + i.qty * i.unit_cost, 0);
  const { data: po, error: poErr } = await srv.from("purchase_orders").insert({
    business_id: input.business_id, supplier_id: input.supplier_id ?? null,
    branch_id: input.branch_id ?? null, total, created_by: m.user.id, notes: input.notes || null,
  }).select("id").single();
  if (poErr || !po) return NextResponse.json({ error: "Could not create purchase order" }, { status: 500 });
  const poId = (po as { id: string }).id;

  // Goods received: append stock movements with an idempotency key per line.
  for (const i of input.items) {
    await srv.from("stock_movements").insert({
      business_id: input.business_id, product_id: i.product_id,
      branch_id: input.branch_id ?? null,
      quantity_delta: Math.abs(i.qty), unit_cost: i.unit_cost,
      reason: "purchase", ref_type: "purchase_order", ref_id: poId,
      idempotency_key: `po-${poId}-${i.product_id}`, created_by: m.user.id,
    });
  }
  await srv.from("purchase_orders").update({ status: "received" }).eq("id", poId);
  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "purchase.receive", entity: "purchase_orders", entity_id: poId,
    after_data: { total, lines: input.items.length },
  });
  return NextResponse.json({ purchase_order_id: poId, total }, { status: 201 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("purchase_orders").select("id,supplier_id,branch_id,status,total,notes,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Could not load purchase orders" }, { status: 500 });
  return NextResponse.json({ purchase_orders: data ?? [] });
}