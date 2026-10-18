import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";

const Schema = z.object({
  business_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  parent_id: z.string().uuid().optional(),
});

/** Categories: create / list. */
export async function POST(req: Request) {
  const rl = rateLimited(req, 30);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  const input = parsed.data;
  const m = await requireMembership(input.business_id, ["owner", "manager", "stockkeeper", "cashier"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("categories").insert({
    business_id: input.business_id, name: input.name, parent_id: input.parent_id ?? null,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Could not create category" }, { status: 500 });
  return NextResponse.json({ category_id: (data as { id: string }).id }, { status: 201 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("categories").select("id,name,parent_id").eq("business_id", businessId).order("name");
  if (error) return NextResponse.json({ error: "Could not load categories" }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}