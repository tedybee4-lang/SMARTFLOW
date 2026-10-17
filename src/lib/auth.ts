import { supabaseServer } from "@/lib/supabase-server";

/** Returns session user or null. */
export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user;
}

/** Verify the user is a member of the business; returns membership row or null. */
export async function requireMembership(businessId: string, roles?: string[]) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("memberships").select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
  if (!data) return null;
  if (roles && !roles.includes(data.role)) return null;
  return { user, role: data.role as string };
}

export async function isPlatformAdmin(): Promise<boolean> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { data } = await sb.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return !!data;
}
