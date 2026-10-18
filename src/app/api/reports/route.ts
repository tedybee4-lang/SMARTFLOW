import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { orderTotals, tierFeeForSales, DEFAULT_TIERS } from "@/lib/money";
import { formatKES } from "@/lib/kenya";

const Schema = z.object({
  business_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Sales / financial summary for a business over a date range.
 * Boundary-safe: `to` is a calendar date, so we include the whole final day.
 */
export async function POST(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  const input = parsed.data;
  const m = await requireMembership(input.business_id, ["owner", "manager", "accountant"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const srv = supabaseServiceRole();
  const toExclusive = new Date(`${input.to}T00:00:00Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const toExclusiveISO = toExclusive.toISOString();

  const [{ data: orders }, { data: payments }, { data: expenses }] = await Promise.all([
    srv.from("orders").select("total_due,amount_paid,status,payment_method")
      .eq("business_id", input.business_id)
      .gte("created_at", input.from).lt("created_at", toExclusiveISO),
    srv.from("payments").select("amount,method,status")
      .eq("business_id", input.business_id)
      .gte("created_at", input.from).lt("created_at", toExclusiveISO),
    srv.from("expenses").select("amount,category,spent_at")
      .eq("business_id", input.business_id)
      .gte("spent_at", input.from).lte("spent_at", input.to),
  ]);

  const orderRows = (orders ?? []) as { total_due: number; amount_paid: number; status: string; payment_method: string }[];
  const qualifying = orderRows
    .filter((o) => !["cancelled", "refunded", "failed"].includes(o.status))
    .reduce((s, o) => s + Number(o.total_due), 0);
  const gross = orderRows.reduce((s, o) => s + Number(o.total_due), 0);
  const collected = orderRows.reduce((s, o) => s + Number(o.amount_paid), 0);
  const outstanding = Math.round((gross - collected) * 100) / 100;
  const totalExpenses = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const net = Math.round((gross - totalExpenses) * 100) / 100;
  const tierFee = tierFeeForSales(qualifying);

  return NextResponse.json({
    range: { from: input.from, to: input.to },
    gross_sales: gross,
    collected,
    outstanding,
    qualifying_sales: qualifying,
    total_expenses: totalExpenses,
    net,
    tier_fee: tierFee,
    tier_fee_label: tierFee === -1 ? "custom" : formatKES(tierFee),
    counts: { orders: orderRows.length, payments: (payments ?? []).length, expenses: (expenses ?? []).length },
  });
}