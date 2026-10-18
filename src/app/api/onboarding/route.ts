import { NextResponse } from "next/server";
import { supabaseServer, supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { normalizeKEPhone } from "@/lib/kenya";
import { OnboardingSchema, isReservedSlug } from "@/lib/validation";

export async function POST(req: Request) {
  const limited = rateLimited(req, 10);
  if (limited) return limited;

  // Validate input
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
    return NextResponse.json({ error: "That storefront link is reserved — choose another" }, { status: 400 });
  }

  // Server-side auth: owner is derived from the session, never from the body.
  const sb = await supabaseServer();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const srv = supabaseServiceRole();

  // Idempotency: if this account already owns a business, return it instead of creating another.
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
    return NextResponse.json({ error: "That storefront link is already taken — try another" }, { status: 409 });
  }

  // Insert business (user-scoped client: RLS enforces owner_user_id = auth.uid()).
  const { data: biz, error: bizErr } = await sb
    .from("businesses")
    .insert({ name, slug, business_type, phone_e164: phoneE164, location, owner_user_id: user.id })
    .select("id")
    .single();
  if (bizErr || !biz) {
    if (bizErr?.code === "23505") {
      return NextResponse.json({ error: "That storefront link is already taken — try another" }, { status: 409 });
    }
    // Never leak internal schema/column details to the client.
    return NextResponse.json({ error: "Could not create business — please try again." }, { status: 500 });
  }

  // Insert owner membership (user-scoped client: RLS "owners add members" check).
  // upsert() with onConflict("business_id,user_id") keeps this idempotent: a retried
  // or duplicate request that already created the membership row is a no-op, and
  // data is returned so a retry can confirm the row exists without a second round-trip.
  const { error: memErr } = await sb
    .from("memberships")
    .upsert(
      [{ business_id: biz.id, user_id: user.id, role: "owner" }],
      { onConflict: "business_id,user_id" },
    )
    .select("business_id");
  if (memErr) {
    // Roll back the half-created business so a retry starts clean.
    await srv.from("businesses").delete().eq("id", biz.id);
    // Never surface DB internals — the 23505 unique violation is already
    // handled above; anything else here is a generic setup failure.
    return NextResponse.json({ error: "Could not complete setup — please try again." }, { status: 500 });
  }

  // Verify membership is queryable before sending the user to the dashboard.
  const { data: membership } = await sb
    .from("memberships")
    .select("business_id")
    .eq("business_id", biz.id)
    .eq("user_id", user.id)
    .eq("role", "owner")
    .maybeSingle();
  if (!membership) {
    await srv.from("businesses").delete().eq("id", biz.id);
    return NextResponse.json({ error: "Setup could not be verified — please try again." }, { status: 500 });
  }

  // Best-effort defaults (service role; non-critical, ignore failures).
  await Promise.allSettled([
    srv.from("branches").insert({ business_id: biz.id, name: "Main", is_default: true }),
    srv.from("storefronts").insert({ business_id: biz.id, slug, published: false }),
    srv.from("audit_logs").insert({ business_id: biz.id, actor_user_id: user.id, entity: "business", entity_id: biz.id, action: "create" }),
  ]);

  return NextResponse.json({ business_id: biz.id, existing: false });
}
