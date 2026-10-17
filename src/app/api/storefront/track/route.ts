import { NextResponse } from "next/server";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { normalizeKEPhone } from "@/lib/kenya";
import { rateLimited } from "@/lib/rate-limit";

/** Customer order lookup by phone (+ optional order no). Only own orders returned. */
export async function GET(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  const url = new URL(req.url);
  const phone = normalizeKEPhone(url.searchParams.get("phone") ?? "");
  const orderNo = url.searchParams.get("order_no")?.trim() ?? "";
  if (!phone) return NextResponse.json({ error: "Valid phone required" }, { status: 400 });

  const srv = supabaseServiceRole();
  const { data: customers } = await srv.from("customers").select("id").eq("phone", phone);
  const ids = ((customers ?? []) as { id: string }[]).map((c) => c.id);
  if (ids.length === 0) return NextResponse.json({ orders: [] });
  let q = srv.from("orders").select("order_no,status,payment_status,total_due,amount_paid,fulfillment,created_at").in("customer_id", ids).order("created_at", { ascending: false }).limit(20);
  if (orderNo) q = q.eq("order_no", orderNo);
  const { data: orders } = await q;
  return NextResponse.json({ orders: orders ?? [] });
}
