import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { SmsPurchaseSchema } from "@/lib/validation";
import { normalizeKEPhone, toSTKFormat } from "@/lib/kenya";
import { resolveChannelForPurpose } from "@/lib/payhero-channel";

/**
 * POST /api/sms/purchase — buy an SMS credit package via central PayHero STK.
 * Credits are issued ONLY after verified callback success (see payhero-callback
 * `sms` purpose branch). This route creates the pending purchase + PayHero
 * attempt; the callback completes the credit.
 */
export async function POST(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  const parsed = SmsPurchaseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid purchase request" }, { status: 400 });
  const input = parsed.data;

  const m = await requireMembership(input.business_id, ["owner", "manager", "accountant"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const phone = normalizeKEPhone(input.phone);
  const stkPhone = toSTKFormat(input.phone);
  if (!phone || !stkPhone) return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });

  const srv = supabaseServiceRole();
  const { data: pkg } = await srv.from("sms_packages").select("id,credits,price_kes").eq("id", input.package_id).eq("is_active", true).maybeSingle();
  const p = pkg as { id: string; credits: number; price_kes: number } | null;
  if (!p) return NextResponse.json({ error: "Package unavailable" }, { status: 404 });

  // Dedupe ONLY recent in-flight purchases: a completed/failed purchase must
  // never block buying the same package again, and a stale pending (user
  // dismissed the STK prompt) is expired so retries can proceed. The
  // idempotency key is unique per attempt; double-clicks within the window
  // collide on the pending lookup below.
  const { data: pending } = await srv.from("sms_purchases")
    .select("id,status,created_at")
    .eq("business_id", input.business_id)
    .eq("package_id", p.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pend = pending as { id: string; created_at: string } | null;
  if (pend) {
    const ageMs = Date.now() - new Date(pend.created_at).getTime();
    if (ageMs < 15 * 60_000) {
      return NextResponse.json({ purchase_id: pend.id, duplicate: true, status: "pending" });
    }
    // Stale pending — expire it (and its attempt) so the business can retry.
    await srv.from("sms_purchases").update({ status: "expired" }).eq("id", pend.id).eq("status", "pending");
  }

  const idem = `sms-${input.business_id}-${p.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: purchase, error: pErr } = await srv.from("sms_purchases").insert({
    business_id: input.business_id,
    package_id: p.id,
    credits: p.credits,
    price_kes: p.price_kes,
    status: "pending",
    idempotency_key: idem,
    created_by: m.user.id,
  }).select("id").single();
  if (pErr || !purchase) return NextResponse.json({ error: "Could not create purchase" }, { status: 500 });
  const purchaseId = (purchase as { id: string }).id;

  const channel = await resolveChannelForPurpose({ purpose: "sms", businessId: input.business_id });
  if (!channel.ok) {
    await srv.from("sms_purchases").update({ status: "failed" }).eq("id", purchaseId);
    return NextResponse.json({ error: "SMS payments are not configured yet - contact support." }, { status: channel.status });
  }
  const channelId = channel.channelId;

  const attemptIdem = `sms-pay-${purchaseId}`;
  const { data: attempt, error: aErr } = await srv.from("payment_attempts").insert({
    business_id: input.business_id,
    purpose: "sms",
    channel_id: channelId,
    channel_source: channel.source,
    amount: p.price_kes,
    phone: stkPhone,
    sms_purchase_id: purchaseId,
    idempotency_key: attemptIdem,
    status: "initiated",
  }).select("id").single();
  if (aErr || !attempt) {
    await srv.from("sms_purchases").update({ status: "failed" }).eq("id", purchaseId);
    return NextResponse.json({ error: "Could not start payment" }, { status: 500 });
  }
  const attemptId = (attempt as { id: string }).id;
  await srv.from("sms_purchases").update({ payment_attempt_id: attemptId }).eq("id", purchaseId);

  let providerRef: string | null = null;
  try {
    const { payheroInitiateSTK } = await import("@/lib/payhero");
    const res = await payheroInitiateSTK({
      amount: Number(p.price_kes),
      phone: stkPhone,
      channelId,
      reference: attemptIdem,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/payments/payhero-callback`,
    });
    providerRef = res.provider_ref;
  } catch {
    // Leave pending for reconciliation; callback may still arrive.
  }
  if (providerRef) {
    await srv.from("payment_attempts").update({ provider_ref: providerRef }).eq("id", attemptId);
  }

  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "sms.purchase_initiated", entity: "sms_purchases", entity_id: purchaseId,
    after_data: { credits: p.credits, price_kes: p.price_kes },
  });

  return NextResponse.json({ purchase_id: purchaseId, attempt_id: attemptId, status: "pending", provider_ref: providerRef }, { status: 201 });
}
