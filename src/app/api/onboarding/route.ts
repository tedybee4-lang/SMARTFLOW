import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseServiceRole } from "@/lib/supabase-server";
import { normalizeKEPhone } from "@/lib/kenya";
import { rateLimited } from "@/lib/rate-limit";

const Schema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  business_type: z.string().default("retail"),
  phone: z.string().min(9),
  location: z.string().optional().default(""),
});

export async function POST(req: Request) {
  const rl = rateLimited(req, 10);
  if (rl) return rl;
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const phone = normalizeKEPhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  // Slug must be unique
  const { data: existing } = await sb.from("businesses").select("id").eq("slug", parsed.data.slug).maybeSingle();
  if (existing) return NextResponse.json({ error: "Slug already taken" }, { status: 409 });

  // Create via service role, then membership for the owner (server-verified user id)
  const srv = supabaseServiceRole();
  const { data: biz, error } = await srv.from("businesses").insert({
    name: parsed.data.name, slug: parsed.data.slug, business_type: parsed.data.business_type,
    phone, location: parsed.data.location, owner_user_id: user.id,
  }).select("id").single();
  if (error || !biz) return NextResponse.json({ error: "Could not create business" }, { status: 500 });
  await srv.from("memberships").insert({ business_id: biz.id, user_id: user.id, role: "owner" });
  await srv.from("branches").insert({ business_id: biz.id, name: "Main branch", is_default: true });
  await srv.from("storefronts").insert({ business_id: biz.id });
  await srv.from("audit_logs").insert({ business_id: biz.id, actor_user_id: user.id, action: "business.created", entity: "businesses", entity_id: biz.id });
  return NextResponse.json({ business_id: biz.id });
}
