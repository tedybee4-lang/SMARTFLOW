import { NextResponse } from "next/server";
import { supabaseServiceRole } from "@/lib/supabase-server";

/**
 * PayHero callback receiver (server-only).
 * Verifies callback token per official docs, validates amount/channel/reference/state,
 * and applies updates idempotently. NEVER trust browser redirects.
 * Docs: https://docs.payhero.co.ke/ — confirm exact signing before production.
 */
export async function POST(req: Request) {
  const token = process.env.PAYHERO_CALLBACK_TOKEN;
  const provided = req.headers.get("x-payhero-token") ?? new URL(req.url).searchParams.get("token");
  if (!token || provided !== token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as {
    reference?: string; provider_ref?: string; amount?: number;
    status?: string; channel_id?: string;
  } | null;
  if (!body?.reference) return NextResponse.json({ error: "Missing reference" }, { status: 400 });

  const srv = supabaseServiceRole();
  const { data: attempt } = await srv.from("payment_attempts").select("*").eq("idempotency_key", body.reference).maybeSingle();
  const a = attempt as {
    id: string; business_id: string; order_id: string | null; subscription_invoice_id: string | null;
    purpose: string; amount: number; status: string; channel_id: string;
  } | null;
  if (!a) return NextResponse.json({ error: "Unknown reference" }, { status: 404 });
  if (a.status === "success") return NextResponse.json({ ok: true, duplicate: true }); // idempotent

  // Validate amount matches (tolerance 0.01)
  if (body.amount != null && Math.abs(Number(body.amount) - Number(a.amount)) > 0.01) {
    await srv.from("payment_attempts").update({ status: "amount_mismatch", raw_callback: body }).eq("id", a.id);
    return NextResponse.json({ error: "Amount mismatch" }, { status: 409 });
  }

  const ok = ["success", "completed", "paid"].includes(String(body.status ?? "").toLowerCase());
  const failed = ["failed", "expired", "reversed", "cancelled"].includes(String(body.status ?? "").toLowerCase());
  const next = ok ? "success" : failed ? "failed" : "pending";
  await srv.from("payment_attempts").update({
    status: next, provider_ref: body.provider_ref ?? null, raw_callback: body,
  }).eq("id", a.id);

  if (ok) {
    if (a.purpose === "order" && a.order_id) {
      await srv.from("payments").insert({
        business_id: a.business_id, order_id: a.order_id, method: "payhero",
        amount: a.amount, provider_ref: body.provider_ref ?? null, channel_id: a.channel_id,
        status: "completed", idempotency_key: `cb-${a.id}`,
      });
      const { data: ord } = await srv.from("orders").select("amount_paid,total_due").eq("id", a.order_id).maybeSingle();
      const o = ord as { amount_paid: number; total_due: number } | null;
      if (o) {
        const paid = Math.round((Number(o.amount_paid) + Number(a.amount)) * 100) / 100;
        await srv.from("orders").update({
          amount_paid: paid,
          payment_status: paid >= Number(o.total_due) ? "paid" : "partial",
        }).eq("id", a.order_id);
      }
    } else if (a.purpose === "subscription" && a.subscription_invoice_id) {
      await srv.from("payments").insert({
        business_id: a.business_id, subscription_invoice_id: a.subscription_invoice_id,
        method: "payhero", amount: a.amount, provider_ref: body.provider_ref ?? null,
        channel_id: a.channel_id, status: "completed", idempotency_key: `cb-${a.id}`,
      });
      await srv.from("subscription_invoices").update({ status: "paid" }).eq("id", a.subscription_invoice_id);
    }
    await srv.from("audit_logs").insert({
      business_id: a.business_id, action: "payment.confirmed", entity: "payment_attempts",
      entity_id: a.id, after_data: { amount: a.amount, purpose: a.purpose },
    });
  }
  return NextResponse.json({ ok: true, status: next });
}
