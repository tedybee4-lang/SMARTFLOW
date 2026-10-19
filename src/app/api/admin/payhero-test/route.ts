import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { PayHeroTestSchema } from "@/lib/validation";
import { normalizeKEPhone, toSTKFormat } from "@/lib/kenya";
import { payheroConfigStatus, payheroInitiateSTKReal } from "@/lib/payhero";
import { channelMatches, resolveChannelForPurpose } from "@/lib/payhero-channel";

/**
 * GET /api/admin/payhero-test — account status (presence booleans only, never
 * secret values) + recent platform payment attempts for health monitoring.
 */
export async function GET() {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  const st = payheroConfigStatus();
  const srv = supabaseServiceRole();
  const { data: recent } = await srv.from("payment_attempts")
    .select("purpose,status,amount,created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  return NextResponse.json({
    payhero: { ...st, hasPlatformChannel: !!process.env.PAYHERO_PLATFORM_CHANNEL_ID },
    recent_attempts: recent ?? [],
  });
}

/**
 * POST /api/admin/payhero-test — validate (dry-run) or send a live test STK.
 * - Dry-run (default): validates config + formats the exact provider payload
 *   WITHOUT touching the network or charging anyone.
 * - Live: requires confirm_live=true AND amount <= 20 KES. Initiates a REAL
 *   STK push to the admin's own phone and records a platform test attempt
 *   (purpose 'platform') for reconciliation. Never auto-confirms payment.
 */
export async function POST(req: Request) {
  const rl = rateLimited(req, 5);
  if (rl) return rl;
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  const parsed = PayHeroTestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const phone = normalizeKEPhone(input.phone);
  const stkPhone = toSTKFormat(input.phone);
  if (!phone || !stkPhone) {
    return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });
  }
  const st = payheroConfigStatus();
  // The channel is SERVER-resolved (platform channel). A client-supplied
  // channel_id is only a comparison hint - it can never redirect the push.
  const resolved = await resolveChannelForPurpose({ purpose: "platform", businessId: null });
  const channelId = resolved.ok ? resolved.channelId : "";
  if (!st.configured || !channelId) {
    return NextResponse.json(
      {
        error: "PayHero not configured - set PAYHERO_API_USERNAME + secret and PAYHERO_PLATFORM_CHANNEL_ID server-side.",
        payhero: { configured: st.configured, hasPlatformChannel: !!channelId },
      },
      { status: 503 },
    );
  }
  if (!channelMatches(channelId, input.channel_id)) {
    return NextResponse.json(
      { error: "Channel mismatch - the platform test channel is server-resolved." },
      { status: 409 },
    );
  }

  // Dry-run: show the exact payload, charge nothing, touch no network.
  if (!input.confirm_live) {
    return NextResponse.json({
      dry_run: true,
      provider_payload: {
        amount: input.amount,
        phone_number: stkPhone,
        channel_id: channelId,
        provider: "m-pesa",
      },
      hint: "Dry-run only — nothing was sent. Set confirm_live=true (amount ≤ 20 KES) to send a real test STK to your own phone.",
    });
  }

  // Live gate: small amounts only, admin's own number, explicitly confirmed.
  if (input.amount > 20) {
    return NextResponse.json(
      { error: "Live test STK is capped at KSh 20. Use dry-run for larger amounts." },
      { status: 400 },
    );
  }

  const reference = `platform-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let providerRef: string | null = null;
  let providerError: string | null = null;
  try {
    const res = await payheroInitiateSTKReal({
      amount: input.amount,
      phone: stkPhone,
      channelId,
      reference,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/payments/payhero-callback`,
    });
    providerRef = res.provider_ref;
  } catch (e) {
    providerError = e instanceof Error ? e.message.slice(0, 200) : "Provider error";
  }

  // Record the test attempt for reconciliation (platform purpose, no business).
  try {
    const srv = supabaseServiceRole();
    await srv.from("payment_attempts").insert({
      purpose: "platform",
      channel_id: channelId,
      channel_source: "platform",
      amount: input.amount,
      phone: stkPhone,
      provider_ref: providerRef,
      status: providerRef ? "initiated" : "failed",
      idempotency_key: reference,
    });
  } catch {
    // Audit record is best-effort; the STK result is authoritative.
  }

  if (providerError && !providerRef) {
    return NextResponse.json({ error: providerError }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    reference,
    provider_ref: providerRef,
    note: "Real STK sent — approve on your phone. Confirm via callback before treating as paid.",
  }, { status: 201 });
}
