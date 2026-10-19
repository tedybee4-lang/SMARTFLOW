import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { CheckoutSchema } from "@/lib/validation";
import { orderTotals } from "@/lib/money";
import { rateLimited } from "@/lib/rate-limit";
import { evaluateSubscription, blockedMessage } from "@/lib/trial";
import { fetchOnHand, type SupabaseLike } from "@/lib/stock";

/**
 * POST /api/sales/checkout — record a sale with ledger-safe stock deduction.
 * Cash/offline/credit recorded immediately. PayHero creates an order in
 * payment_pending; the STK route + server callback confirm payment — a client
 * redirect never marks an order paid.
 *
 * Hardening (Stage 9):
 * - Catalogue + price + stock validation runs BEFORE any order row is written
 *   (no orphan orders on bad input).
 * - Discounts (line or order level) require owner/manager — cashiers cannot
 *   self-authorise price reductions.
 * - Optional `client_ref` idempotency key makes double-submitted checkouts
 *   return the first order instead of creating a duplicate.
 * - Stock availability is checked against the ledger before deduction.
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

  // --- Discounts are a privileged action (owner/manager only). ---
  const discountTotal = input.order_discount + input.items.reduce((s, i) => s + (i.discount ?? 0), 0);
  if (discountTotal > 0 && !["owner", "manager"].includes(m.role)) {
    return NextResponse.json({ error: "Only owners/managers can apply discounts" }, { status: 403 });
  }

  // --- Totals are derived from SERVER catalogue prices (computed after the
  //        catalogue + stock gates below). Client unit_price is never trusted
  //        for money math — see the orderTotals call after validation.
  let totals: ReturnType<typeof orderTotals> | null = null;

  const srv = supabaseServiceRole();

  // --- Idempotency: repeated submissions with the same client_ref return the first order. ---
  if (input.client_ref) {
    const { data: existing } = await srv
      .from("orders")
      .select("id,order_no,payment_status,total_due")
      .eq("business_id", input.business_id)
      .like("notes", `[client:${input.client_ref}]%`)
      .maybeSingle();
    const ex = existing as { id: string; order_no: string; payment_status: string; total_due: number } | null;
    if (ex) {
      return NextResponse.json({ order_id: ex.id, order_no: ex.order_no, duplicate: true, total_due: Number(ex.total_due) });
    }
  }

  // --- Subscription gate: block selling when trial expired / past due / suspended. ---
  const subRes = await (srv.from("subscriptions") as unknown as {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
    };
  }).select("status,trial_started_at,trial_ends_at,current_period_start,current_period_end,subscription_plans(grace_days)")
    .eq("business_id", input.business_id).maybeSingle();
  const subRow = subRes.data as import("@/lib/trial").SubscriptionRow;
  const subEval = evaluateSubscription(subRow, new Date());
  if (!subEval.canSell) {
    return NextResponse.json(
      { error: blockedMessage(subEval.state) || "Selling is blocked for this subscription" },
      { status: 402 },
    );
  }

  // --- Catalogue validation BEFORE creating the order (no orphan orders). ---
  const productIds = [...new Set(input.items.map((i) => i.product_id))];
  type ProdRow = { id: string; name: string; selling_price: number; tax_rate: number; is_active: boolean; track_stock: boolean };
  // Cast to a minimal builder shape: the full PostgREST generics nest too
  // deeply for tsc when select+eq+in are written together (TS2589).
  const prodRes = await (srv.from("products") as unknown as {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        in: (col: string, vals: unknown[]) => PromiseLike<{ data: ProdRow[] | null }>;
      };
    };
  }).select("id,name,selling_price,tax_rate,is_active,track_stock").eq("business_id", input.business_id).in("id", productIds);
  const products = prodRes.data;
  const catalog = new Map((products ?? []).map((p) => [p.id, p]));
  if (catalog.size !== productIds.length) {
    return NextResponse.json({ error: "Some items are unavailable" }, { status: 400 });
  }
  for (const pid of productIds) {
    if (!catalog.get(pid)!.is_active) {
      return NextResponse.json({ error: "Some items are no longer for sale" }, { status: 409 });
    }
  }
  // Client unit prices must match catalogue within 0.01 (prevents price tampering)
  for (const i of input.items) {
    const p = catalog.get(i.product_id)!;
    if (Math.abs(Number(i.unit_price) - Number(p.selling_price)) > 0.01) {
      return NextResponse.json({ error: "Price mismatch — please refresh products and retry" }, { status: 409 });
    }
    if ((i.discount ?? 0) > i.qty * Number(i.unit_price)) {
      return NextResponse.json({ error: "Line discount exceeds line total" }, { status: 400 });
    }
  }

  // --- Stock availability check (tracked products only, from the ledger). ---
  const tracked = productIds.filter((pid) => catalog.get(pid)!.track_stock);
  const onHand = await fetchOnHand(srv as unknown as SupabaseLike, input.business_id, tracked);
  const requested = new Map<string, number>();
  for (const i of input.items) {
    requested.set(i.product_id, (requested.get(i.product_id) ?? 0) + i.qty);
  }
  for (const [pid, qty] of requested) {
    if (!catalog.get(pid)!.track_stock) continue;
    const available = onHand.get(pid) ?? 0;
    if (qty > available + 1e-9) {
      return NextResponse.json(
        { error: `Insufficient stock for “${catalog.get(pid)!.name}” — ${available} available, ${qty} requested` },
        { status: 409 },
      );
    }
  }

  // --- Totals from SERVER prices: money math is recomputed against the
  //        verified catalogue so a tampered client unit_price can never move
  //        the charged total. Math errors → 400.
  try {
    totals = orderTotals(
      input.items.map((i) => ({
        qty: i.qty,
        unitPrice: Number(catalog.get(i.product_id)!.selling_price),
        discount: i.discount,
      })),
      { orderDiscount: input.order_discount, taxRate: input.tax_rate },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid totals" }, { status: 400 });
  }

  const orderNo = `ORD-${Date.now().toString(36).toUpperCase()}`;
  const idem = `sale-${input.business_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isPayhero = input.payment_method === "payhero";

  // --- 1. Create order (all validations passed). ---
  const paidAmount = isPayhero ? 0 : input.amount_paid;
  const paymentStatus = isPayhero ? "unpaid"
    : paidAmount <= 0 ? "unpaid"
    : paidAmount + 0.005 >= totals.totalDue ? "paid" : "partial";
  const { data: order, error: orderErr } = await srv.from("orders").insert({
    business_id: input.business_id,
    customer_id: input.customer_id ?? null,
    order_no: orderNo,
    status: isPayhero ? "payment_pending" : "processing",
    payment_status: paymentStatus,
    subtotal: totals.subtotal,
    discount_total: totals.discountTotal,
    tax_total: totals.taxTotal,
    total_due: totals.totalDue,
    amount_paid: paidAmount,
    notes: input.client_ref ? `[client:${input.client_ref}] ${input.notes ?? ""}`.trim() : input.notes,
    created_by: m.user.id,
  }).select("id").single();
  if (orderErr || !order) return NextResponse.json({ error: "Could not create order" }, { status: 500 });
  const orderId = (order as { id: string }).id;

  // --- 2. Order items — immutable price/name snapshots from the verified catalogue. ---
  const nameById = new Map([...catalog.values()].map((p) => [p.id, p.name]));
  await srv.from("order_items").insert(
    input.items.map((i) => ({
      order_id: orderId,
      product_id: i.product_id,
      name_snapshot: nameById.get(i.product_id) ?? "Item",
      qty: i.qty,
      unit_price: Number(catalog.get(i.product_id)!.selling_price), // snapshot = server price, not client echo
      discount: i.discount,
      line_total: Math.round((i.qty * Number(catalog.get(i.product_id)!.selling_price) - i.discount) * 100) / 100,
    })),
  );

  // --- 3. Stock movements (idempotent key per order+product). PayHero orders
  //        reserve stock now; cancel/refund transitions restore it. ---
  for (const i of input.items) {
    if (!catalog.get(i.product_id)!.track_stock) continue;
    await srv.from("stock_movements").insert({
      business_id: input.business_id,
      product_id: i.product_id,
      quantity_delta: -Math.abs(i.qty),
      reason: "sale",
      ref_type: "order",
      ref_id: orderId,
      idempotency_key: `${idem}-${i.product_id}`,
      created_by: m.user.id,
    });
  }
  await srv.from("orders").update({ stock_deducted: true }).eq("id", orderId);

  // --- 4. Payment record for non-PayHero. ---
  if (!isPayhero && paymentStatus !== "unpaid") {
    await srv.from("payments").insert({
      business_id: input.business_id,
      order_id: orderId,
      method: input.payment_method,
      amount: Math.min(paidAmount, totals.totalDue),
      status: "completed",
      idempotency_key: `${idem}-pay`,
      received_by: m.user.id,
    });
  }

  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "sale.checkout", entity: "orders", entity_id: orderId,
    after_data: { total_due: totals.totalDue, method: input.payment_method, discount: totals.discountTotal },
  });

  return NextResponse.json({
    order_id: orderId,
    order_no: orderNo,
    payment_status: paymentStatus,
    await_payment: isPayhero,
    ...totals,
  });
}

