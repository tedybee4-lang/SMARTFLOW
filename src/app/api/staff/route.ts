import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership, isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { isBusinessRole, canAssignRole, canRemoveMember, type BusinessRole } from "@/lib/access";

const Schema = z.object({
  business_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.string(),
  action: z.enum(["add", "update_role", "remove"]),
});

/**
 * Staff management: add/update/remove memberships.
 * Only owners + managers can change staff; only owners may touch the owner role.
 * A member can never remove themselves, and no route can create a platform-admin
 * via the memberships table — platform admin lives in `platform_admins` only.
 */
export async function POST(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { business_id, user_id, role, action } = parsed.data;

  const m = await requireMembership(business_id, ["owner", "manager"]);
  if (!m) {
    // requireMembership returns null both for unauthenticated callers and for
    // non-members; distinguish them so clients get the right status code.
    const { supabaseServer } = await import("@/lib/supabase-server");
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    return NextResponse.json(
      { error: user ? "Not authorized" : "Not authenticated" },
      { status: user ? 403 : 401 },
    );
  }

  if (action === "remove" && user_id === m.user.id) {
    return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
  }

  const srv = supabaseServiceRole();
  if (action === "add" || action === "update_role") {
    if (!isBusinessRole(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (!canAssignRole(m.role, role)) {
      return NextResponse.json({ error: "You cannot assign that role" }, { status: 403 });
    }
    if (action === "add") {
      const { data: existing } = await srv.from("memberships").select("id").eq("business_id", business_id).eq("user_id", user_id).maybeSingle();
      if (existing) {
        return NextResponse.json({ error: "User is already a member" }, { status: 409 });
      }
      const { error } = await srv.from("memberships").insert({ business_id, user_id, role });
      if (error) return NextResponse.json({ error: "Could not add member" }, { status: 500 });
    } else {
      const { data: target } = await srv.from("memberships").select("role").eq("business_id", business_id).eq("user_id", user_id).maybeSingle();
      const targetRole = (target as { role: string } | null)?.role;
      if (targetRole === undefined) return NextResponse.json({ error: "Member not found" }, { status: 404 });
      if (targetRole === "owner" && m.role !== "owner") {
        return NextResponse.json({ error: "Only owners can change another owner" }, { status: 403 });
      }
      const { error } = await srv.from("memberships").update({ role }).eq("business_id", business_id).eq("user_id", user_id);
      if (error) return NextResponse.json({ error: "Could not update role" }, { status: 500 });
    }
    await srv.from("audit_logs").insert({
      business_id, actor_user_id: m.user.id, action: `staff.${action}`,
      entity: "memberships", entity_id: null,
      after_data: { user_id, role },
    });
    return NextResponse.json({ ok: true });
  }

  // remove
  const { data: target } = await srv.from("memberships").select("role").eq("business_id", business_id).eq("user_id", user_id).maybeSingle();
  const targetRole = (target as { role: string } | null)?.role;
  if (!targetRole) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (!canRemoveMember(m.role, targetRole, false)) {
    return NextResponse.json({ error: "You cannot remove that member" }, { status: 403 });
  }
  const { error } = await srv.from("memberships").delete().eq("business_id", business_id).eq("user_id", user_id);
  if (error) return NextResponse.json({ error: "Could not remove member" }, { status: 500 });
  await srv.from("audit_logs").insert({
    business_id, actor_user_id: m.user.id, action: "staff.remove",
    entity: "memberships", entity_id: null,
    before_data: { user_id, role: targetRole },
  });
  return NextResponse.json({ ok: true });
}

/** List members of a business (owners/managers see all; others see themselves). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 });
  const m = await requireMembership(businessId);
  if (!m) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const srv = supabaseServiceRole();
  const { data, error } = await srv.from("memberships").select("user_id,role,created_at").eq("business_id", businessId).order("created_at");
  if (error) return NextResponse.json({ error: "Could not load members" }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}