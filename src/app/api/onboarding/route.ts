import { NextResponse } from "next/server";
import { supabaseServer, supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { normalizeKEPhone } from "@/lib/kenya";
import { OnboardingSchema, isReservedSlug } from "@/lib/validation";

export async function POST(req: Request) {
  const limited = rateLimited(req, 10);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = OnboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { name, slug, business_type, location } = parsed.data;
  const phoneE164 = normalizeKEPhone(parsed.data.phone);
  if (!phoneE164) {
    return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });
  }
  if (isReservedSlug(slug)) {
    return NextResponse.json({ error: "That storefront link is reserved - choose another" }, { status: 400 });
  }

  const sb = await supabaseServer();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const srv = (() => {
    try {
      return supabaseServiceRole();
    } catch {
      console.error("[onboarding] service-role credentials not configured");
      return null;
    }
  })();
  if (!srv) {
    return NextResponse.json(
      { error: "Business setup is temporarily unavailable - please try again.", code: "service_unavailable" },
      { status: 503 },
    );
  }

  // Idempotency: if this account already owns a business, return it instead
  // of creating another (prevents duplicate businesses / duplicate trials on
  // retry or double-submit).
  const { data: existingRow } = await srv
    .from("businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .limit(1);
  if (existingRow && existingRow.length > 0) {
    return NextResponse.json({ business_id: existingRow[0].id, existing: true });
  }

  // Slug uniqueness (service role so RLS can't hide a taken slug from this check).
  const { data: slugRow } = await srv
    .from("businesses")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (slugRow) {
    return NextResponse.json({ error: "That storefront link is already taken - try another" }, { status: 409 });
  }

  // Insert business via SERVICE ROLE: the user-scoped client cannot create the
  // owner membership (RLS requires an existing owner role — a chicken-and-egg
  // on first business creation / live PGRST116). Server-side auth above is the
  // trust boundary; owner_user_id is derived from the session, never the body.
  const { data: biz, error: bizErr } = await srv
    .from("businesses")
    .insert({ name, slug, business_type, phone_e164: phoneE164, location, owner_user_id: user.id })
    .select("id")
    .single();
  if (bizErr || !biz) {
    if (bizErr?.code === "23505") {
      return NextResponse.json({ error: "That storefront link is already taken - try another", code: "slug_taken" }, { status: 409 });
    }
    console.error("[onboarding] business insert failed", { code: bizErr?.code ?? null });
    return NextResponse.json({ error: "Could not create business - please try again.", code: "business_create_failed" }, { status: 500 });
  }

  const { error: memErr } = await srv
    .from("memberships")
    .upsert(
      [{ business_id: biz.id, user_id: user.id, role: "owner" }],
      { onConflict: "business_id,user_id" },
    )
    .select("business_id");
  if (memErr) {
    console.error("[onboarding] owner membership write failed", { code: (memErr as { code?: string })?.code ?? null });
    await srv.from("businesses").delete().eq("id", biz.id);
    return NextResponse.json({ error: "Could not complete setup - please try again.", code: "membership_failed" }, { status: 500 });
  }

  const { data: membership } = await srv
    .from("memberships")
    .select("business_id")
    .eq("business_id", biz.id)
    .eq("user_id", user.id)
    .eq("role", "owner")
    .maybeSingle();
  if (!membership) {
    await srv.from("businesses").delete().eq("id", biz.id);
    return NextResponse.json({ error: "Setup could not be verified - please try again." }, { status: 500 });
  }

  // Best-effort bootstrap rows — a failure here must NOT fail onboarding
  // (the business + owner membership above are the source of truth).
  // NOTE: storefronts has NO `slug`/`published` columns — it uses
  // `is_published` keyed by business_id (see migration 0004b).
  await Promise.allSettled([
    srv.from("branches").insert({ business_id: biz.id, name: "Main", is_default: true }),
    srv.from("storefronts").insert({ business_id: biz.id, is_published: false }),
    srv.from("audit_logs").insert({ business_id: biz.id, actor_user_id: user.id, entity: "business", entity_id: biz.id, action: "create" }),
  ]);

  return NextResponse.json({ business_id: biz.id, existing: false });
}
