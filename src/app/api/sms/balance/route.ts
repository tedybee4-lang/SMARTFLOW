import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";

/** GET /api/sms/balance?business_id=… — credit balance + recent ledger. */
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const srv = supabaseServiceRole();
  const [{ data: bal }, { data: ledger }, { data: purchases }] = await Promise.all([
    srv.from("sms_balances").select("balance").eq("business_id", businessId).maybeSingle(),
    srv.from("sms_ledger").select("kind,credits,note,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20),
    srv.from("sms_purchases").select("credits,price_kes,status,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20),
  ]);
  return NextResponse.json({
    balance: (bal as { balance: number } | null)?.balance ?? 0,
    ledger: ledger ?? [],
    purchases: purchases ?? [],
  });
}
