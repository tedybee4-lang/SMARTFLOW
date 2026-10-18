import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { SmsSendSchema } from "@/lib/validation";
import { normalizeKEPhone } from "@/lib/kenya";
import { smsSegments, sendSMS } from "@/lib/messaging";

/**
 * POST /api/sms/send — billable SMS via the central TOPSPEED integration.
 * Debits the business SMS ledger (1 credit = 1 segment). Blocks when balance
 * is insufficient. Idempotent via idempotency_key. Refunds on provider failure.
 */
export async function POST(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const parsed = SmsSendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid SMS request" }, { status: 400 });
  const input = parsed.data;

  const m = await requireMembership(input.business_id, ["owner", "manager", "cashier", "salesperson"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const to = normalizeKEPhone(input.to);
  if (!to) return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });

  const segments = smsSegments(input.message);
  const srv = supabaseServiceRole();
  const idem = input.idempotency_key ?? `sms-send-${input.business_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Idempotency: return the existing message instead of double-charging.
  const { data: dup } = await srv.from("sms_messages").select("id,status,provider_ref,credits_charged").eq("idempotency_key", idem).maybeSingle();
  if (dup) {
    const d = dup as { id: string; status: string; provider_ref: string | null; credits_charged: number };
    return NextResponse.json({ message_id: d.id, duplicate: true, status: d.status, provider_ref: d.provider_ref, segments_charged: d.credits_charged });
  }

  const { data: balRow } = await srv.from("sms_balances").select("balance").eq("business_id", input.business_id).maybeSingle();
  const balance = (balRow as { balance: number } | null)?.balance ?? 0;
  if (balance < segments) {
    return NextResponse.json(
      { error: `Insufficient SMS credits (need ${segments}, have ${balance}). Buy credits to continue.`, balance, segments_required: segments, purchase_url: "/settings?tab=sms" },
      { status: 402 },
    );
  }

  // Create the queued message + debit ledger + decrement balance.
  const { data: msg, error: msgErr } = await srv.from("sms_messages").insert({
    business_id: input.business_id,
    recipient: to,
    body: input.message,
    segments,
    credits_charged: segments,
    status: "queued",
    idempotency_key: idem,
    created_by: m.user.id,
  }).select("id").single();
  if (msgErr || !msg) return NextResponse.json({ error: "Could not queue SMS" }, { status: 500 });
  const messageId = (msg as { id: string }).id;

  await srv.from("sms_ledger").insert({
    business_id: input.business_id,
    kind: "send_debit",
    credits: -segments,
    message_id: messageId,
    idempotency_key: `debit-${idem}`,
    note: `Send to ${to} (${segments} segment${segments === 1 ? "" : "s"})`,
    created_by: m.user.id,
  });
  await srv.from("sms_balances").upsert(
    { business_id: input.business_id, balance: balance - segments },
    { onConflict: "business_id" },
  );

  // Central provider send (server-side only; businesses never hold credentials).
  let providerRef: string | null = null;
  let providerError: string | null = null;
  try {
    const res = await sendSMS(to, input.message);
    if (res.ok) providerRef = res.provider_ref;
    else providerError = res.error ?? "Provider failed";
  } catch (e) {
    providerError = e instanceof Error ? e.message.slice(0, 200) : "Provider error";
  }

  if (providerError && !providerRef) {
    // Provider failure: mark failed + refund the debit so retries can't double-charge.
    await srv.from("sms_messages").update({ status: "failed", provider_error: providerError }).eq("id", messageId);
    await srv.from("sms_ledger").insert({
      business_id: input.business_id,
      kind: "send_refund",
      credits: segments,
      message_id: messageId,
      idempotency_key: `refund-${idem}`,
      note: `Refund: provider failed (${providerError.slice(0, 120)})`,
      created_by: m.user.id,
    });
    const { data: cur } = await srv.from("sms_balances").select("balance").eq("business_id", input.business_id).maybeSingle();
    const curBal = (cur as { balance: number } | null)?.balance ?? 0;
    await srv.from("sms_balances").upsert({ business_id: input.business_id, balance: curBal + segments }, { onConflict: "business_id" });
    await srv.from("audit_logs").insert({
      business_id: input.business_id, actor_user_id: m.user.id,
      action: "sms.send_failed", entity: "sms_messages", entity_id: messageId,
      after_data: { error: providerError },
    });
    return NextResponse.json({ message_id: messageId, status: "failed", error: "SMS provider failed — credits refunded. Try again shortly." }, { status: 502 });
  }

  await srv.from("sms_messages").update({ status: "sent", provider_ref: providerRef }).eq("id", messageId);
  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "sms.sent", entity: "sms_messages", entity_id: messageId,
    after_data: { segments, provider_ref: providerRef },
  });
  return NextResponse.json({ message_id: messageId, status: "sent", provider_ref: providerRef, segments_charged: segments, balance: balance - segments }, { status: 201 });
}
