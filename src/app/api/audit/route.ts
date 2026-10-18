import { NextResponse } from "next/server";
import { requireMembership, isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";

/** Audit log viewer (read-only). */
export async function GET(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });

  // Owners, managers and accountants may read their business audit trail;
  // platform admins may read any.
  const admin = await isPlatformAdmin();
  if (!admin) {
    const m = await requireMembership(businessId, ["owner", "manager", "accountant"]);
    if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("audit_logs")
    .select("id,actor_user_id,action,entity,entity_id,before_data,after_data,created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: "Could not load audit logs" }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}