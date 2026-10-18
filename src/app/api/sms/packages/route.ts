import { NextResponse } from "next/server";
import { supabaseServiceRole } from "@/lib/supabase-server";

/** GET /api/sms/packages — public active SMS package catalog. */
export async function GET() {
  const srv = supabaseServiceRole();
  const { data, error } = await srv
    .from("sms_packages")
    .select("id,name,credits,price_kes,is_active")
    .eq("is_active", true)
    .order("price_kes");
  if (error) return NextResponse.json({ error: "Could not load packages" }, { status: 500 });
  return NextResponse.json({ packages: data ?? [] });
}
