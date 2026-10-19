import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { normalizeKEPhone, toSTKFormat } from "@/lib/kenya";
import { channelMatches, resolveChannelForPurpose } from "@/lib/payhero-channel";
import { verifyPaymentReference } from "@/lib/payment-ownership";

/**
 * PayHero STK push initiation.
 *
 * Security model (server-owned data):
 *  - The PayHero channel is resolved SERVER-side: order payments use the
 *    business' own channel, subscription/SMS payments use the central platform
 *    channel. A client-supplied `channel_id` is only a COMPARISON HINT — a
 *    mismatch is refused and the stored channel is always the resolved one.
 *  - The referenced order / invoice / SMS purchase must belong to the calling
 *    business. Cross-tenant ids are refused before any attempt row is written.
 *  - The amount charged is the server-side amount owed, never a client number.
 *
 * Creates an idempotent payment_attempt row and calls the provider.
 * The provider call is mocked in tests; in production it uses PAYHERO_* env.
 * NEVER charge a real customer without authorization.
 */
const Schema = z.object({
  business_id: z.string().uuid(),
  purpose: z.enum(["order", "subscription", "sms"]),
  order_id: z.string().uuid().optional(),
  subscription_invoice_id: z.string().uuid().optional(),
  sms_purchase_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  phone: z.string().min(9),
  /** Optional comparison hint only — the server value always wins. */
  channel_id: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid STK request" }, { status: 400 });
  const input = parsed.data;

  const m = await requireMembership(input.business_id, ["owner", "manager", "cashier", "accountant"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const phone = normalizeKEPhone(input.phone);
  if (!phone) return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });
  const stkPhone = toSTKFormat(input.phone);
  if (!stkPhone) return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });

  // --- 1. Ownership: the referenced entity must belong to THIS business. ---
  const owned = await verifyPaymentReference({
    businessId: input.business_id,
    purpose: input.purpose,
    orderId: input.order_id,
    subscriptionInvoiceId: input.subscription_invoice_id,
    smsPurchaseId: input.sms_purchase_id,
  });
  if (!owned.ok) {
    return NextResponse.json({ error: owned.error }, { status: owned.status });
  }

  // --- 2. Amount comes from the server-side reference, not the client. ---
  // Checked BEFORE channel resolution so an already-settled reference always
  // reports "settled" (409) regardless of channel configuration state.
  const expected = owned.remaining;
  if (expected <= 0) {
    return NextResponse.json(
      { error: "This payment has already been settled." },
      { status: 409 },
    );
  }
  if (Math.abs(expected - input.amount) > 0.01) {
    return NextResponse.json(
      { error: "Amount mismatch - refresh and try again." },
      { status: 409 },
    );
  }
  const amount = Math.round(expected * 100) / 100;

  // --- 3. Server-owned channel resolution (never the client's choice). ---
  const channel = await resolveChannelForPurpose({
    purpose: input.purpose,
    businessId: input.business_id,
  });
  if (!channel.ok) {
    return NextResponse.json({ error: channel.error }, { status: channel.status });
  }
  if (!channelMatches(channel.channelId, input.channel_id)) {
    return NextResponse.json(
      { error: "Payment channel mismatch - refresh and try again." },
      { status: 409 },
    );
  }

  const srv = supabaseServiceRole();
  const refId =
    input.order_id ?? input.subscription_invoice_id ?? input.sms_purchase_id ?? "";
  const idem = `stk-${input.business_id}-${input.purpose}-${refId}-${Math.round(amount * 100)}`;
  const { data: existing } = await srv.from("payment_attempts").select("id,status,provider_ref").eq("idempotency_key", idem).maybeSingle();
  if (existing) {
    return NextResponse.json({ attempt_id: (existing as { id: string }).id, duplicate: true, status: (existing as { status: string }).status });
  }

  const { data: attempt, error } = await srv.from("payment_attempts").insert({
    business_id: input.business_id,
    order_id: input.purpose === "order" ? input.order_id ?? null : null,
    subscription_invoice_id: input.purpose === "subscription" ? input.subscription_invoice_id ?? null : null,
    sms_purchase_id: input.purpose === "sms" ? input.sms_purchase_id ?? null : null,
    purpose: input.purpose,
    channel_id: channel.channelId,
    channel_source: channel.source,
    amount,
    phone: stkPhone,
    idempotency_key: idem,
    status: "initiated",
  }).select("id").single();
  if (error || !attempt) return NextResponse.json({ error: "Could not create payment attempt" }, { status: 500 });
  const attemptId = (attempt as { id: string }).id;

  // Provider call — mocked in tests, real in production when PAYHERO_* set.
  let providerRef: string | null = null;
  try {
    const { payheroInitiateSTK } = await import("@/lib/payhero");
    const res = await payheroInitiateSTK({
      amount,
      phone: stkPhone,
      channelId: channel.channelId,
      reference: idem,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/payments/payhero-callback`,
    });
    providerRef = (res as { provider_ref?: string | null } | null)?.provider_ref ?? null;
  } catch {
    // Provider not configured — leave the attempt as "initiated" so the
    // callback path can still reconcile when credentials arrive.
  }

  if (providerRef) {
    await srv.from("payment_attempts").update({ provider_ref: providerRef }).eq("id", attemptId);
  }

  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "payment.stk_initiated", entity: "payment_attempts", entity_id: attemptId,
    after_data: {
      amount, phone: stkPhone, purpose: input.purpose,
      channel_id: channel.channelId, channel_source: channel.source, provider_ref: providerRef,
    },
  });
  return NextResponse.json({ attempt_id: attemptId, provider_ref: providerRef, status: "initiated" }, { status: 201 });
}