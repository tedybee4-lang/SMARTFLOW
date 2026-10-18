import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { evaluateSubscription, blockedMessage } from "@/lib/trial";

/**
 * Subscription access guard: returns the caller's subscription status.
 * Used by the app shell to gate features (e.g. block POS when suspended).
 * Trial state is evaluated by the pure helpers in @/lib/trial.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data: sub } = await srv
    .from("subscriptions")
    .select("status,trial_started_at,trial_ends_at,qualifying_sales,current_period_start,current_period_end,subscription_plans(name,fee,max_qualifying_sales,grace_days)")
    .eq("business_id", businessId)
    .maybeSingle();
  const s = sub as {
    status: string;
    trial_started_at: string | null;
    trial_ends_at: string | null;
    qualifying_sales: number;
    current_period_start: string | null;
    current_period_end: string | null;
    subscription_plans: { name: string; fee: number; max_qualifying_sales: number | null; grace_days: number } | null;
  } | null;

  const evalResult = evaluateSubscription(s ? { ...s, subscription_plans: s.subscription_plans } : null, new Date());
  const blocked = blockedMessage(evalResult.state);

  return NextResponse.json({
    status: s?.status ?? "none",
    state: evalResult.state,
    plan: s?.subscription_plans ?? null,
    qualifying_sales: s?.qualifying_sales ?? 0,
    trial: evalResult.trialEndsAt
      ? { ends_at: evalResult.trialEndsAt, days_left: evalResult.trialDaysLeft }
      : null,
    period: s?.current_period_start && s?.current_period_end
      ? { start: s.current_period_start, end: s.current_period_end }
      : null,
    can_sell: evalResult.canSell,
    ...(blocked ? { blocked_reason: blocked } : {}),
  });
}