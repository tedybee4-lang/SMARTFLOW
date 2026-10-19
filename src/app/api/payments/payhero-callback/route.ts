import { NextResponse } from "next/server";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { verifyAttemptOwnership } from "@/lib/payment-ownership";

/**
 * PayHero callback receiver (server-only).
 * Verifies callback token per official docs, validates amount/channel/reference/state,
 * and applies updates idempotently. NEVER trust browser redirects.
 *
 * Ownership gate: the attempt row is looked up by its idempotency key, then the
 * referenced entity (order / subscription invoice / SMS purchase) is re-verified
 * to belong to the attempt's own business BEFORE anything is credited. A
 * callback can therefore never move money, mark an order paid, or grant SMS
 * credits across a tenant boundary.
 *
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
    id: string; business_id: string | null; order_id: string | null; subscription_invoice_id: string | null;
    sms_purchase_id?: string | null; purpose: string; amount: number; status: string; channel_id: string;
  } | null;
  if (!a) return NextResponse.json({ error: "Unknown reference" }, { status: 404 });
  if (a.status === "success") return NextResponse.json({ ok: true, duplicate: true }); // idempotent

  // --- Amount gate: the provider must report the amount WE stored. Nothing is
  // credited here, so it is safe to evaluate before the ownership gate.
  if (body.amount != null && Math.abs(Number(body.amount) - Number(a.amount)) > 0.01) {
    await srv.from("payment_attempts").update({ status: "amount_mismatch", raw_callback: body }).eq("id", a.id);
    return NextResponse.json({ error: "Amount mismatch" }, { status: 409 });
  }

  // --- Channel gate: the provider must report the channel WE resolved and
  // stored. Nothing is credited here either.
  const cbChannel = (body.channel_id ?? "").trim();
  if (cbChannel && cbChannel !== (a.channel_id ?? "").trim()) {
    await srv.from("payment_attempts").update({ status: "channel_mismatch", raw_callback: body }).eq("id", a.id);
    return NextResponse.json({ error: "Channel mismatch" }, { status: 409 });
  }

  const ok = ["success", "completed", "paid"].includes(String(body.status ?? "").toLowerCase());
  const failed = ["failed", "expired", "reversed", "cancelled"].includes(String(body.status ?? "").toLowerCase());
  const next = ok ? "success" : failed ? "failed" : "pending";

  // --- Ownership gate: the credited entity must belong to the attempt's own
  // business. It only guards CREDITING — a failed/pending callback moves no
  // money and touches no tenant entity, so it is still recorded.
  let own: Awaited<ReturnType<typeof verifyAttemptOwnership>> | null = null;
  if (ok) {
    own = await verifyAttemptOwnership({
      business_id: a.business_id,
      purpose: a.purpose,
      order_id: a.order_id,
      subscription_invoice_id: a.subscription_invoice_id,
      sms_purchase_id: a.sms_purchase_id ?? null,
    });
    if (!own.ok) {
      await srv.from("payment_attempts").update({
        status: "ownership_violation", raw_callback: body,
      }).eq("id", a.id);
      await srv.from("audit_logs").insert({
        business_id: a.business_id, action: "payment.ownership_violation",
        entity: "payment_attempts", entity_id: a.id,
        after_data: { reason: own.error, purpose: a.purpose },
      });
      return NextResponse.json({ error: "Payment reference not found." }, { status: 404 });
    }
  }

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
      // Use the SAME verified snapshot that passed the ownership gate. Re-reading
      // the order here would open a TOCTOU window where the row could change
      // between the ownership check and the credit.
      const alreadyPaid = Number(own?.amountPaid ?? 0);
      const totalDue = Number(own?.total ?? 0);
      const paid = Math.round((alreadyPaid + Number(a.amount)) * 100) / 100;
      await srv.from("orders").update({
        amount_paid: paid,
        payment_status: totalDue > 0 && paid >= totalDue ? "paid" : "partial",
      }).eq("id", a.order_id);
    } else if (a.purpose === "subscription" && a.subscription_invoice_id) {
      await srv.from("payments").insert({
        business_id: a.business_id, subscription_invoice_id: a.subscription_invoice_id,
        method: "payhero", amount: a.amount, provider_ref: body.provider_ref ?? null,
        channel_id: a.channel_id, status: "completed", idempotency_key: `cb-${a.id}`,
      });
      await srv.from("subscription_invoices").update({ status: "paid" }).eq("id", a.subscription_invoice_id);
    } else if (a.purpose === "sms") {
      // SMS package purchase: credit ONLY after verified provider success.
      // Idempotent via sms_ledger idempotency_key `purchase-${purchaseId}`.
      const purchaseId = a.sms_purchase_id ?? null;
      // `own` is the ownership-verified purchase snapshot: it carries the owning
      // business and the granted credits, so no second (unverified) read is needed.
      if (purchaseId && own?.ok && own.kind === "sms_purchase" && own.status !== "completed") {
        const credits = Number(own.credits ?? 0);
        const priceKes = Number(own.total ?? 0);
        await srv.from("sms_purchases").update({ status: "completed" }).eq("id", purchaseId);
        await srv.from("sms_ledger").insert({
          business_id: a.business_id,
          kind: "purchase",
          credits,
          payment_attempt_id: a.id,
          idempotency_key: `purchase-${purchaseId}`,
          note: `Package purchase ${credits} credits for KSh ${priceKes}`,
        });
        const { data: balRow } = await srv.from("sms_balances")
          .select("balance").eq("business_id", a.business_id).maybeSingle();
        const curBal = (balRow as { balance: number } | null)?.balance ?? 0;
        await srv.from("sms_balances").upsert(
          { business_id: a.business_id, balance: curBal + credits },
          { onConflict: "business_id" },
        );
      }
    }
    await srv.from("audit_logs").insert({
      business_id: a.business_id, action: "payment.confirmed", entity: "payment_attempts",
      entity_id: a.id, after_data: { amount: a.amount, purpose: a.purpose },
    });
  }
  return NextResponse.json({ ok: true, status: next });
}
