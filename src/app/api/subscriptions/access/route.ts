import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership, isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";

/**
 * Subscription access guard: returns the caller's subscription status.
 * Used by the app shell to gate features (e.g. block POS when suspended).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data: sub } = await srv.from("subscriptions").select("status,qualifying_sales,current_period_start,current_period_end,subscription_plans(name,fee,max_qualifying_sales,grace_days)").eq("business_id", businessId).maybeSingle();
  const s = sub as { status: string; qualifying_sales: number; current_period_start: string | null; current_period_end: string | null; subscription_plans: { name: string; fee: number; max_qualifying_sales: number | null; grace_days: number } | null } | null;
  return NextResponse.json({
    status: s?.status ?? "trial",
    plan: s?.subscription_plans ?? null,
    qualifying_sales: s?.qualifying_sales ?? 0,
    period: s?.current_period_start && s?.current_period_end
      ? { start: s.current_period_start, end: s.current_period_end }
      : null,
    can_sell: s ? s.status !== "suspended" && s.status !== "cancelled" : true,
  });
}