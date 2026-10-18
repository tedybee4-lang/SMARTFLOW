import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { isReservedSlug } from "@/lib/validation";

const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, "Use lowercase letters, numbers and dashes (1–50 chars)");

const Schema = z.object({
  business_id: z.string().uuid(),
  slug: SlugSchema.optional(),
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

  // Slug change: format + reserved + global uniqueness (service role so RLS
  // can't hide a taken slug). The businesses.slug unique index is the backstop.
  if (input.slug !== undefined) {
    if (isReservedSlug(input.slug)) {
      return NextResponse.json({ error: "That storefront link is reserved — choose another" }, { status: 400 });
    }
    const { data: taken } = await srv
      .from("businesses")
      .select("id")
      .eq("slug", input.slug)
      .neq("id", input.business_id)
      .maybeSingle();
    if (taken) {
      return NextResponse.json({ error: "That storefront link is already taken — try another" }, { status: 409 });
    }
  }

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

  let slug = null;
  if (input.slug !== undefined) {
    const { data: bizRow, error: slugErr } = await srv
      .from("businesses")
      .update({ slug: input.slug })
      .eq("id", input.business_id)
      .select("slug")
      .maybeSingle();
    if (slugErr) {
      if (slugErr.code === "23505") {
        return NextResponse.json({ error: "That storefront link is already taken — try another" }, { status: 409 });
      }
      return NextResponse.json({ error: "Could not update the storefront link" }, { status: 500 });
    }
    slug = (bizRow as { slug: string } | null)?.slug ?? input.slug;
  }

  await srv.from("audit_logs").insert({
    business_id: input.business_id, actor_user_id: m.user.id,
    action: "storefront.update", entity: "storefronts", entity_id: null,
    after_data: payload,
  });
  return NextResponse.json({ storefront: result.data, slug });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const [{ data }, { data: biz }] = await Promise.all([
    srv.from("storefronts").select("*").eq("business_id", businessId).maybeSingle(),
    srv.from("businesses").select("slug").eq("id", businessId).maybeSingle(),
  ]);
  return NextResponse.json({ storefront: data, slug: (biz as { slug: string } | null)?.slug ?? null });
}