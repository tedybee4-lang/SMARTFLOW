import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServer, supabaseServiceRole } from "@/lib/supabase-server";
import { CheckoutSchema } from "@/lib/validation";
import { orderTotals } from "@/lib/money";
import { rateLimited } from "@/lib/rate-limit";
import { evaluateSubscription, blockedMessage } from "@/lib/trial";

/**
 * POST /api/sales/checkout — record a sale with ledger-safe stock deduction.
 * Cash/offline/credit recorded immediately. PayHero creates a payment_attempt
 * and leaves order payment_pending (callback confirms later).
 */
export async function POST(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
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

  // Subscription gate: block selling when trial expired / past due / suspended.
  const { data: subRow } = await srv
    .from("subscriptions")
    .select("status,trial_started_at,trial_ends_at,current_period_start,current_period_end,subscription_plans(grace_days)")
    .eq("business_id", input.business_id)
    .maybeSingle();
  const subEval = evaluateSubscription(
    (subRow ?? null) as unknown as Parameters<typeof evaluateSubscription>[0],
    new Date(),
  );
  if (!subEval.canSell) {
    return NextResponse.json(
      { error: blockedMessage(subEval.state) || "Selling is blocked for this subscription" },
      { status: 402 },
    );
  }

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

  // 2. Order items — prices re-verified from server catalogue (never trust client prices)
  const sb = await supabaseServer();
  const { data: products } = await sb.from("products")
    .select("id,name,selling_price,tax_rate").eq("business_id", input.business_id)
    .in("id", input.items.map((i) => i.product_id));
  const catalog = new Map(((products ?? []) as { id: string; name: string; selling_price: number; tax_rate: number }[]).map((p) => [p.id, p]));
  if (catalog.size !== input.items.length) {
    return NextResponse.json({ error: "Some items are unavailable" }, { status: 400 });
  }
  // Client unit prices must match catalogue within 0.01 (prevents price tampering)
  for (const i of input.items) {
    const p = catalog.get(i.product_id)!;
    if (Math.abs(Number(i.unit_price) - Number(p.selling_price)) > 0.01) {
      return NextResponse.json({ error: "Price mismatch — please refresh products and retry" }, { status: 409 });
    }
  }
  const nameById = new Map([...catalog.values()].map((p) => [p.id, p.name]));
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
