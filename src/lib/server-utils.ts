import "server-only";
import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { isBusinessRole, canAssignRole, canRemoveMember, type BusinessRole } from "@/lib/access";

/** Standard 401/403 shape used by every server route. */
export function unauthenticated() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}
export function forbidden() {
  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
}
export function badRequest(msg = "Invalid input") {
  return NextResponse.json({ error: msg }, { status: 400 });
}
export function notFound(msg = "Not found") {
  return NextResponse.json({ error: msg }, { status: 404 });
}
export function conflict(msg = "Conflict") {
  return NextResponse.json({ error: msg }, { status: 409 });
}
export function serverError(msg = "Could not complete request — please try again.") {
  // Never leak DB internals: callers pass a generic message.
  return NextResponse.json({ error: msg }, { status: 500 });
}

/** Rate-limit wrapper that returns a 429 response or null. */
export function checkRateLimit(req: Request, max: number) {
  return rateLimited(req, max);
}

/**
 * Resolve the business id for the request.
 * - If `businessId` is provided it must belong to the caller (checked via
 *   requireMembership). If the caller is not a member, the request is rejected.
 * - Otherwise the caller's first membership is used (POS/products/expenses
 *   pages all default to "my first business").
 */
export async function resolveBusinessId(
  businessId: string | null | undefined,
  roles?: string[],
): Promise<{ business_id: string; role: string } | NextResponse> {
  if (businessId) {
    const m = await requireMembership(businessId, roles);
    if (!m) return forbidden();
    return { business_id: businessId, role: m.role };
  }
  // Fall back to the caller's first membership.
  const { supabaseServer } = await import("@/lib/supabase-server");
  const sb = await supabaseServer();
  const { data: ms } = await sb.from("memberships").select("business_id,role").limit(1);
  const first = ms?.[0] as { business_id: string; role: string } | undefined;
  if (!first) return forbidden();
  if (roles && !roles.includes(first.role)) return forbidden();
  return { business_id: first.business_id, role: first.role };
}

/** Service-role client (server-only). */
export function srv() {
  return supabaseServiceRole();
}

/** Write an audit_log row; failures are swallowed (best-effort). */
export async function audit(
  businessId: string,
  actorUserId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  beforeData: Record<string, unknown> | null = null,
  afterData: Record<string, unknown> | null = null,
) {
  try {
    await supabaseServiceRole().from("audit_logs").insert({
      business_id: businessId,
      actor_user_id: actorUserId,
      action,
      entity,
      entity_id: entityId,
      before_data: beforeData,
      after_data: afterData,
    });
  } catch {
    /* best-effort */
  }
}

/** Re-export access helpers for route modules that prefer a single import. */
export { isBusinessRole, canAssignRole, canRemoveMember };
export type { BusinessRole };