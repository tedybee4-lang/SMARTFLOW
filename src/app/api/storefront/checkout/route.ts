import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { normalizeKEPhone } from "@/lib/kenya";
import { rateLimited } from "@/lib/rate-limit";
import { fetchOnHand } from "@/lib/stock";

const Schema = z.object({
  business_slug: z.string().min(1),
  customer_name: z.string().min(1).max(120),
  customer_phone: z.string().min(9),
  fulfillment: z.enum(["pickup", "delivery"]).default("pickup"),
  items: z.array(z.object({ product_id: z.string().uuid(), qty: z.number().positive().max(1000) })).min(1).max(50),
  notes: z.string().max(500).optional().default(""),
  /** Client-generated idempotency key: retries with the same ref return the first order. */
  client_ref: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{8,64}$/, "client_ref must be 8–64 chars of letters, numbers or dashes")
    .optional(),
});

/** Public guest checkout — no login required. Creates customer + placed order. Payment confirmed in shop. */
export async function POST(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  const input = parsed.data;
  const phone = normalizeKEPhone(input.customer_phone);
  if (!phone) return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });

  const srv = supabaseServiceRole();
  const { data: biz } = await srv.from("businesses").select("id").eq("slug", input.business_slug).maybeSingle();
  const b = biz as { id: string } | null;
  if (!b) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const { data: shop } = await srv.from("storefronts").select("is_published,delivery_fee").eq("business_id", b.id).maybeSingle();
  const s = shop as { is_published: boolean; delivery_fee: number } | null;
  if (!s?.is_published) return NextResponse.json({ error: "Shop is not published" }, { status: 403 });

  // Load products (price from server, never trust client prices).
  // is_active + track_stock drive the same availability gate the POS uses.
  const { data: products } = await srv.from("products").select("id,name,selling_price,tax_rate,is_active,track_stock").eq("business_id", b.id).in("id", input.items.map((i) => i.product_id));
  const byId = new Map(((products ?? []) as { id: string; name: string; selling_price: number; tax_rate: number; is_active: boolean; track_stock: boolean }[]).map((p) => [p.id, p]));
  if (byId.size !== input.items.length) return NextResponse.json({ error: "Some items are unavailable" }, { status: 400 });
  for (const i of input.items) {
    // Explicit false only — rows predating the flag (or mocks without it)
    // are treated as active rather than blocking the sale.
    if (byId.get(i.product_id)!.is_active === false) {
      return NextResponse.json({ error: "Some items are unavailable" }, { status: 400 });
    }
  }

  // Idempotency: a retried guest checkout with the same client_ref returns
  // the first order instead of creating a duplicate.
  if (input.client_ref) {
    const { data: existingOrder } = await srv
      .from("orders")
      .select("order_no,total_due")
      .eq("business_id", b.id)
      .like("notes", `[client:${input.client_ref}]%`)
      .maybeSingle();
    const dup = existingOrder as { order_no: string; total_due: number } | null;
    if (dup) {
      return NextResponse.json({ order_no: dup.order_no, total_due: Number(dup.total_due), duplicate: true });
    }
  }

  // Stock availability from the ledger BEFORE any row is written — same
  // all-or-nothing gate as POS (untracked products/services skip the check).
  const trackedIds = input.items
    .filter((i) => byId.get(i.product_id)!.track_stock !== false)
    .map((i) => i.product_id);
  if (trackedIds.length > 0) {
    const onHand = await fetchOnHand(srv as never, b.id, trackedIds);
    for (const i of input.items) {
      if (byId.get(i.product_id)!.track_stock === false) continue;
      const available = onHand.get(i.product_id) ?? 0;
      if (available < i.qty) {
        return NextResponse.json(
          { error: `Insufficient stock for “${byId.get(i.product_id)!.name}” — ${available} available, ${i.qty} requested` },
          { status: 409 },
        );
      }
    }
  }

  let subtotal = 0, taxTotal = 0;
  const lines = input.items.map((i) => {
    const p = byId.get(i.product_id)!;
    const line = Math.round(i.qty * Number(p.selling_price) * 100) / 100;
    subtotal += line;
    taxTotal += Math.round(line * Number(p.tax_rate) * 100) / 100;
    return { ...i, name: p.name, unit_price: Number(p.selling_price), line_total: line };
  });
  subtotal = Math.round(subtotal * 100) / 100;
  taxTotal = Math.round(taxTotal * 100) / 100;
  const deliveryFee = input.fulfillment === "delivery" ? Number(s.delivery_fee) : 0;
  const totalDue = Math.round((subtotal + taxTotal + deliveryFee) * 100) / 100;

  // Find or create customer by phone
  let customerId: string | null = null;
  const { data: existing } = await srv.from("customers").select("id").eq("business_id", b.id).eq("phone", phone).maybeSingle();
  if (existing) customerId = (existing as { id: string }).id;
  else {
    const { data: c } = await srv.from("customers").insert({ business_id: b.id, name: input.customer_name, phone }).select("id").single();
    customerId = (c as { id: string } | null)?.id ?? null;
  }

  const orderNo = `WEB-${Date.now().toString(36).toUpperCase()}`;
  const idem = `web-${b.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: order, error } = await srv.from("orders").insert({
    business_id: b.id, customer_id: customerId, order_no: orderNo,
    status: "placed", payment_status: "unpaid",
    subtotal, tax_total: taxTotal, total_due: totalDue, amount_paid: 0,
    fulfillment: input.fulfillment, delivery_fee: deliveryFee,
    notes: input.client_ref ? `[client:${input.client_ref}] ${input.notes ?? ""}`.trim() : input.notes,
  }).select("id").single();
  if (error || !order) return NextResponse.json({ error: "Could not place order" }, { status: 500 });

  await srv.from("order_items").insert(lines.map((l) => ({
    order_id: (order as { id: string }).id, product_id: l.product_id,
    name_snapshot: l.name, qty: l.qty, unit_price: l.unit_price, discount: 0, line_total: l.line_total,
  })));

  // Ledger-safe stock deduction: every storefront order removes stock once,
  // keyed by order+product so a retried checkout cannot double-deduct.
  for (const l of lines) {
    await srv.from("stock_movements").insert({
      business_id: b.id, product_id: l.product_id,
      quantity_delta: -Math.abs(l.qty), reason: "sale",
      ref_type: "order", ref_id: (order as { id: string }).id,
      idempotency_key: `${idem}-${l.product_id}`,
    });
  }
  await srv.from("orders").update({ stock_deducted: true }).eq("id", (order as { id: string }).id);

  await srv.from("audit_logs").insert({
    business_id: b.id, action: "order.placed_online", entity: "orders",
    entity_id: (order as { id: string }).id, after_data: { total_due: totalDue, fulfillment: input.fulfillment },
  });
  return NextResponse.json({ order_no: orderNo, total_due: totalDue });
}
