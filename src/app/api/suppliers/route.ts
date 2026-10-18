import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { normalizeKEPhone } from "@/lib/kenya";

const Schema = z.object({
  business_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  phone: z.string().max(20).optional().default(""),
  email: z.string().email().optional().default(""),
});

/** Suppliers: create / list. */
export async function POST(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid supplier" }, { status: 400 });
  const input = parsed.data;
  const m = await requireMembership(input.business_id, ["owner", "manager", "stockkeeper", "accountant"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const phone = input.phone ? (normalizeKEPhone(input.phone) ?? input.phone) : null;
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("suppliers").insert({
    business_id: input.business_id, name: input.name, phone, email: input.email || null,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Could not create supplier" }, { status: 500 });
  return NextResponse.json({ supplier_id: (data as { id: string }).id }, { status: 201 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("suppliers").select("id,name,phone,email,balance").eq("business_id", businessId).order("name");
  if (error) return NextResponse.json({ error: "Could not load suppliers" }, { status: 500 });
  return NextResponse.json({ suppliers: data ?? [] });
}