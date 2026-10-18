import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership, isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";

const Schema = z.object({
  business_id: z.string().uuid(),
  is_published: z.boolean().optional(),
  hero_text: z.string().max(500).optional(),
  delivery_fee: z.number().min(0).optional(),
  whatsapp_number: z.string().max(20).optional(),
  policies: z.record(z.string(), z.unknown()).optional(),
});

/** Storefront settings: owners + managers only. */
export async function POST(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const input = parsed.data;

  const m = await requireMembership(input.business_id, ["owner", "manager"]);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const srv = supabaseServiceRole();
  const { data: existing } = await srv.from("storefronts").select("business_id").eq("business_id", input.business_id).maybeSingle();
  const payload: Record<string, unknown> = { business_id: input.business_id };
  if (input.is_published !== undefined) payload.is_published = input.is_published;
  if (input.hero_text !== undefined) payload.hero_text = input.hero_text || null;
  if (input.delivery_fee !== undefined) payload.delivery_fee = input.delivery_fee;
  if (input.whatsapp_number !== undefined) payload.whatsapp_number = input.whatsapp_number || null;
  if (input.policies !== undefined) payload.policies = input.policies;

  let result;
  if (existing) {
    result = await srv.from("storefronts").update(payload).eq("business_id", input.business_id).select("*").maybeSingle();
  } else {
    result = await srv.from("storefronts").insert(payload).select("*").maybeSingle();
  }
  if (result.error) return NextResponse.json({ error: "Could not save storefront" }, { status: 500 });
  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "storefront.update", entity: "storefronts", entity_id: null,
    after_data: payload,
  });
  return NextResponse.json({ storefront: result.data });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data } = await srv.from("storefronts").select("*").eq("business_id", businessId).maybeSingle();
  return NextResponse.json({ storefront: data });
}