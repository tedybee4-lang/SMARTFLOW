import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { PaymentChannelSchema } from "@/lib/validation";

/**
 * GET  /api/business/payment-channel?business_id=…  → current Till/PayBill/channel settings
 * PUT  …                                              → upsert settings (owner/manager only)
 */
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const srv = supabaseServiceRole();
  const { data } = await srv
    .from("business_payment_channels")
    .select("payment_method, till_number, paybill_number, channel_id, is_active")
    .eq("business_id", businessId)
    .maybeSingle();
  const row = data as {
    payment_method: string | null;
    till_number: string | null;
    paybill_number: string | null;
    channel_id: string | null;
    is_active: boolean;
  } | null;
  return NextResponse.json({
    payment_method: row?.payment_method ?? null,
    till_number: row?.till_number ?? "",
    paybill_number: row?.paybill_number ?? "",
    channel_id: row?.channel_id ?? "",
    is_active: row?.is_active ?? false,
    configured: !!row?.payment_method,
  });
}

export async function PUT(req: Request) {
  const limited = rateLimited(req, 20);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PaymentChannelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Only owners/managers may change payment settings (mirrors RLS policy
  // "owners manage channels" — checked here for a clear 403 before writing).
  const m = await requireMembership(input.business_id, ["owner", "manager"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Only store the target that matches the active method — stale numbers for
  // other methods must never linger as live settings.
  const payload: Record<string, unknown> = {
    business_id: input.business_id,
    payment_method: input.payment_method,
    till_number: input.payment_method === "till" ? input.till_number : null,
    paybill_number: input.payment_method === "paybill" ? input.paybill_number : null,
    channel_id: input.payment_method === "payhero" ? input.channel_id : null,
    is_active: input.is_active,
  };

  const srv = supabaseServiceRole();
  const { error } = await srv
    .from("business_payment_channels")
    .upsert(payload, { onConflict: "business_id" });
  if (error) {
    // chk_payment_channel_target or schema-cache issues — never leak internals.
    return NextResponse.json({ error: "Could not save payment settings — please try again." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    payment_method: input.payment_method,
    till_number: payload.till_number,
    paybill_number: payload.paybill_number,
    channel_id: payload.channel_id,
    is_active: input.is_active,
    configured: true,
  });
}
