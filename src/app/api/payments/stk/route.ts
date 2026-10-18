import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership, isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { normalizeKEPhone, toSTKFormat } from "@/lib/kenya";
import { orderTotals } from "@/lib/money";

/**
 * PayHero STK push initiation.
 * Creates an idempotent payment_attempt row and calls the provider.
 * The provider call is mocked in tests; in production it uses PAYHERO_* env.
 * NEVER charge a real customer without authorization.
 */
const Schema = z.object({
  business_id: z.string().uuid(),
  purpose: z.enum(["order", "subscription"]),
  order_id: z.string().uuid().optional(),
  subscription_invoice_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  phone: z.string().min(9),
  channel_id: z.string().min(1),
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

  if (!input.order_id && !input.subscription_invoice_id) {
    return NextResponse.json({ error: "order_id or subscription_invoice_id required" }, { status: 400 });
  }

  const srv = supabaseServiceRole();
  const idem = `stk-${input.business_id}-${input.purpose}-${input.order_id ?? input.subscription_invoice_id}-${Math.round(input.amount * 100)}`;
  const { data: existing } = await srv.from("payment_attempts").select("id,status,provider_ref").eq("idempotency_key", idem).maybeSingle();
  if (existing) {
    return NextResponse.json({ attempt_id: (existing as { id: string }).id, duplicate: true, status: (existing as { status: string }).status });
  }

  const { data: attempt, error } = await srv.from("payment_attempts").insert({
    business_id: input.business_id,
    order_id: input.order_id ?? null,
    subscription_invoice_id: input.subscription_invoice_id ?? null,
    purpose: input.purpose,
    channel_id: input.channel_id,
    amount: input.amount,
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
      amount: input.amount,
      phone: stkPhone,
      channelId: input.channel_id,
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
    after_data: { amount: input.amount, phone: stkPhone, channel_id: input.channel_id, provider_ref: providerRef },
  });
  return NextResponse.json({ attempt_id: attemptId, provider_ref: providerRef, status: "initiated" }, { status: 201 });
}