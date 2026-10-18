import { NextResponse } from "next/server";
import { z } from "zod";
import { isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";

const Schema = z.object({
  business_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Platform-admin subscription invoice generation.
 * Qualifying sales = completed legitimate sales (delivered/processing/ready/dispatched,
 * not cancelled/refunded) across ALL payment methods incl. cash, minus refunds.
 */
export async function POST(req: Request) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { business_id, period_start, period_end } = parsed.data;
  const srv = supabaseServiceRole();

  // Boundary-safe window: period_end is a calendar date, so we must include
  // the whole final day. Comparing a timestamptz to a bare date string
  // (`.lte("created_at", period_end)`) silently drops everything after
  // 00:00:00 on the last day. Shift the upper bound to the next midnight.
  const periodEndExclusive = new Date(`${period_end}T00:00:00Z`);
  periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + 1);
  const periodEndExclusiveISO = periodEndExclusive.toISOString().slice(0, 10);

  const { data: orders } = await srv.from("orders").select("total_due,status")
    .eq("business_id", business_id).gte("created_at", period_start).lt("created_at", periodEndExclusiveISO)
    .not("status", "in", "(cancelled,refunded,failed)");
  const qualifying = Math.round(((orders ?? []) as { total_due: number }[]).reduce((s, o) => s + Number(o.total_due), 0) * 100) / 100;

  const { data: plans } = await srv.from("subscription_plans").select("id,fee,max_qualifying_sales").eq("is_active", true).order("fee");
  const list = (plans ?? []) as { id: string; fee: number; max_qualifying_sales: number | null }[];
  const plan = list.find((p) => p.max_qualifying_sales == null || qualifying <= Number(p.max_qualifying_sales));
  if (!plan) return NextResponse.json({ error: "Sales exceed configured tiers — assign a custom plan first. No charge applied." }, { status: 409 });

  const { data: sub } = await srv.from("subscriptions").select("id").eq("business_id", business_id).maybeSingle();
  let subscriptionId = (sub as { id: string } | null)?.id;
  if (!subscriptionId) {
    const { data: created } = await srv.from("subscriptions").insert({ business_id, plan_id: plan.id, status: "active" }).select("id").single();
    subscriptionId = (created as { id: string } | null)?.id;
  }
  const { data: inv, error } = await srv.from("subscription_invoices").insert({
    business_id, subscription_id: subscriptionId, period_start, period_end,
    qualifying_sales: qualifying, amount: plan.fee, status: "unpaid",
  }).select("id").single();
  if (error || !inv) return NextResponse.json({ error: "Could not create invoice" }, { status: 500 });
  await srv.from("audit_logs").insert({
    business_id, action: "subscription.invoiced", entity: "subscription_invoices",
    entity_id: (inv as { id: string }).id, after_data: { qualifying_sales: qualifying, amount: plan.fee },
  });
  return NextResponse.json({ invoice_id: (inv as { id: string }).id, qualifying_sales: qualifying, amount: plan.fee });
}
