import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServer, supabaseServiceRole } from "@/lib/supabase-server";
import { CheckoutSchema } from "@/lib/validation";
import { orderTotals } from "@/lib/money";

/**
 * POST /api/sales/checkout — record a sale with ledger-safe stock deduction.
 * Cash/offline/credit recorded immediately. PayHero creates a payment_attempt
 * and leaves order payment_pending (callback confirms later).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid sale input" }, { status: 400 });
  const input = parsed.data;

  const m = await requireMembership(input.business_id, ["owner", "manager", "cashier", "salesperson"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const totals = orderTotals(
    input.items.map((i) => ({ qty: i.qty, unitPrice: i.unit_price, discount: i.discount })),
    { orderDiscount: input.order_discount, taxRate: input.tax_rate },
  );

  const srv = supabaseServiceRole();
  const orderNo = `ORD-${Date.now().toString(36).toUpperCase()}`;
  const idem = `sale-${input.business_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1. Create order
  const { data: order, error: orderErr } = await srv.from("orders").insert({
    business_id: input.business_id,
    customer_id: input.customer_id ?? null,
    order_no: orderNo,
    status: "processing",
    payment_status: input.payment_method === "cash" || input.amount_paid >= totals.totalDue ? "paid" : input.amount_paid > 0 ? "partial" : "unpaid",
    subtotal: totals.subtotal,
    discount_total: totals.discountTotal,
    tax_total: totals.taxTotal,
    total_due: totals.totalDue,
    amount_paid: input.payment_method === "payhero" ? 0 : input.amount_paid,
    notes: input.notes,
    created_by: m.user.id,
  }).select("id").single();
  if (orderErr || !order) return NextResponse.json({ error: "Could not create order" }, { status: 500 });

  // 2. Order items (with product name snapshots)
  const sb = await supabaseServer();
  const { data: products } = await sb.from("products").select("id,name").eq("business_id", input.business_id);
  const nameById = new Map((products ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
  await srv.from("order_items").insert(
    input.items.map((i) => ({
      order_id: order.id,
      product_id: i.product_id,
      name_snapshot: nameById.get(i.product_id) ?? "Item",
      qty: i.qty,
      unit_price: i.unit_price,
      discount: i.discount,
      line_total: Math.round((i.qty * i.unit_price - i.discount) * 100) / 100,
    })),
  );

  // 3. Stock movements (idempotent key per order+product)
  for (const i of input.items) {
    await srv.from("stock_movements").insert({
      business_id: input.business_id,
      product_id: i.product_id,
      quantity_delta: -Math.abs(i.qty),
      reason: "sale",
      ref_type: "order",
      ref_id: order.id,
      idempotency_key: `${idem}-${i.product_id}`,
      created_by: m.user.id,
    });
  }
  await srv.from("orders").update({ stock_deducted: true }).eq("id", order.id);

  // 4. Payment record for non-PayHero
  if (input.payment_method !== "payhero" && input.amount_paid > 0) {
    await srv.from("payments").insert({
      business_id: input.business_id,
      order_id: order.id,
      method: input.payment_method,
      amount: Math.min(input.amount_paid, totals.totalDue),
      status: "completed",
      idempotency_key: `${idem}-pay`,
      received_by: m.user.id,
    });
  }

  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "sale.checkout", entity: "orders", entity_id: order.id,
    after_data: { total_due: totals.totalDue, method: input.payment_method },
  });

  return NextResponse.json({ order_id: order.id, order_no: orderNo, ...totals });
}
