import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { SmsPackageManageSchema } from "@/lib/validation";

/**
 * GET /api/admin/sms-packages — full catalog (active + inactive) + sales stats.
 * Only platform admins may change package prices/credits/availability.
 * Existing purchases retain their recorded terms (snapshot in sms_purchases).
 */
export async function GET() {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  const srv = supabaseServiceRole();
  const [{ data: packages }, { data: purchases }] = await Promise.all([
    srv.from("sms_packages").select("id,name,credits,price_kes,is_active,created_at").order("price_kes"),
    srv.from("sms_purchases")
      .select("package_id,credits,price_kes,status")
      .eq("status", "completed"),
  ]);
  const rows = (purchases ?? []) as { package_id: string; credits: number; price_kes: number }[];
  const grossRevenue = rows.reduce((s, r) => s + Number(r.price_kes ?? 0), 0);
  const creditsIssued = rows.reduce((s, r) => s + Number(r.credits ?? 0), 0);
  return NextResponse.json({
    packages: packages ?? [],
    stats: {
      completed_purchases: rows.length,
      gross_revenue_kes: Math.round(grossRevenue * 100) / 100,
      credits_issued: creditsIssued,
    },
  });
}

/**
 * POST /api/admin/sms-packages — create a package (admin only).
 * PATCH — update price/credits/availability by id (admin only).
 */
export async function POST(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  const parsed = SmsPackageManageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.name == null || parsed.data.credits == null || parsed.data.price_kes == null) {
    return NextResponse.json({ error: "name, credits and price_kes are required" }, { status: 400 });
  }
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("sms_packages").insert({
    name: parsed.data.name,
    credits: parsed.data.credits,
    price_kes: parsed.data.price_kes,
    is_active: parsed.data.is_active ?? true,
  }).select("id,name,credits,price_kes,is_active").single();
  if (error || !data) return NextResponse.json({ error: "Could not create package" }, { status: 500 });
  return NextResponse.json({ package: data }, { status: 201 });
}

export async function PATCH(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  const parsed = SmsPackageManageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parsed.data.id) {
    return NextResponse.json({ error: "Package id is required" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (parsed.data.name != null) patch.name = parsed.data.name;
  if (parsed.data.credits != null) patch.credits = parsed.data.credits;
  if (parsed.data.price_kes != null) patch.price_kes = parsed.data.price_kes;
  if (parsed.data.is_active != null) patch.is_active = parsed.data.is_active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("sms_packages")
    .update(patch).eq("id", parsed.data.id)
    .select("id,name,credits,price_kes,is_active").single();
  if (error || !data) return NextResponse.json({ error: "Could not update package" }, { status: 500 });
  return NextResponse.json({ package: data });
}
