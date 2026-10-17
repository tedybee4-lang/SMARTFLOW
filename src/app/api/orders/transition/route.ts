import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";

const Schema = z.object({
  order_id: z.string().uuid(),
  action: z.enum(["confirm_payment", "start_processing", "mark_ready", "mark_dispatched", "mark_delivered", "cancel", "refund"]),
  amount: z.number().positive().optional(),
});

const TRANSITIONS: Record<string, string[]> = {
  confirm_payment: ["placed"],
  start_processing: ["placed"],
  mark_ready: ["processing"],
  mark_dispatched: ["processing", "ready"],
  mark_delivered: ["ready", "dispatched"],
  cancel: ["placed", "processing"],
  refund: ["delivered", "processing"],
};

/** Authorized order lifecycle transitions with guarded single stock restore. */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const { order_id, action, amount } = parsed.data;
  const srv = supabaseServiceRole();

  const { data: order } = await srv.from("orders").select("id,business_id,status,payment_status,total_due,amount_paid,stock_deducted,stock_restored").eq("id", order_id).maybeSingle();
  const o = order as { id: string; business_id: string; status: string; payment_status: string; total_due: number; amount_paid: number; stock_deducted: boolean; stock_restored: boolean } | null;
  if (!o) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const m = await requireMembership(o.business_id, ["owner", "manager", "cashier", "salesperson", "delivery"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!TRANSITIONS[action].includes(o.status)) {
    return NextResponse.json({ error: `Cannot ${action} from status ${o.status}` }, { status: 409 });
  }

  const patch: Record<string, unknown> = {};
  if (action === "confirm_payment") {
    const pay = amount ?? Number(o.total_due);
    patch.payment_status = pay >= Number(o.total_due) ? "paid" : "partial";
    patch.amount_paid = Math.round((Number(o.amount_paid) + pay) * 100) / 100;
    await srv.from("payments").insert({
      business_id: o.business_id, order_id, method: "offline",
      amount: pay, status: "completed",
      idempotency_key: `confirm-${order_id}-${Date.now()}`, received_by: m.user.id,
    });
  } else if (action === "start_processing") {
    patch.status = "processing";
    // Deduct stock once when processing starts (if POS didn't already)
    if (!o.stock_deducted) {
      const { data: items } = await srv.from("order_items").select("product_id,qty").eq("order_id", order_id);
      for (const it of (items ?? []) as { product_id: string; qty: number }[]) {
        await srv.from("stock_movements").insert({
          business_id: o.business_id, product_id: it.product_id,
          quantity_delta: -Math.abs(Number(it.qty)), reason: "sale",
          ref_type: "order", ref_id: order_id,
          idempotency_key: `process-${order_id}-${it.product_id}`, created_by: m.user.id,
        });
      }
      patch.stock_deducted = true;
    }
  } else if (action === "mark_ready") patch.status = "ready";
  else if (action === "mark_dispatched") patch.status = "dispatched";
  else if (action === "mark_delivered") { patch.status = "delivered"; }
  else if (action === "cancel" || action === "refund") {
    patch.status = action === "cancel" ? "cancelled" : "refunded";
    // Restore stock exactly once
    if (o.stock_deducted && !o.stock_restored) {
      const { data: items } = await srv.from("order_items").select("product_id,qty").eq("order_id", order_id);
      for (const it of (items ?? []) as { product_id: string; qty: number }[]) {
        await srv.from("stock_movements").insert({
          business_id: o.business_id, product_id: it.product_id,
          quantity_delta: Math.abs(Number(it.qty)), reason: action === "cancel" ? "return" : "refund_restore",
          ref_type: "order", ref_id: order_id,
          idempotency_key: `restore-${order_id}-${it.product_id}`, created_by: m.user.id,
        });
      }
      patch.stock_restored = true;
    }
  }

  const { error } = await srv.from("orders").update(patch).eq("id", order_id);
  if (error) return NextResponse.json({ error: "Transition failed" }, { status: 500 });
  await srv.from("audit_logs").insert({
    business_id: o.business_id, actor_user_id: m.user.id,
    action: `order.${action}`, entity: "orders", entity_id: order_id,
    before_data: { status: o.status }, after_data: patch,
  });
  return NextResponse.json({ ok: true, ...patch });
}
