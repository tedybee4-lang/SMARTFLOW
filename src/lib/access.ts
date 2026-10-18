/**
 * Shared, testable access-control helpers. Pure functions only — no I/O.
 * These encode the separation between business users, customers and the
 * platform super admin. Server routes and pages enforce the same rules
 * against real Supabase sessions + RLS; these helpers keep the naming and
 * boundaries in one reviewable place.
 */

/** Business membership roles that exist in `public.memberships.role`.
 *  Platform administration is NOT a membership role — it lives in `public.platform_admins`. */
export const BUSINESS_ROLES = [
  "owner",
  "manager",
  "cashier",
  "salesperson",
  "stockkeeper",
  "accountant",
  "delivery",
  "support",
] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

/** Roles allowed to change memberships (mirrors server checks in /api/staff). */
export const MEMBERSHIP_MANAGER_ROLES: readonly BusinessRole[] = ["owner", "manager"];

/** A role value can never smuggle platform-admin power through the memberships table. */
export function isBusinessRole(role: string): role is BusinessRole {
  return (BUSINESS_ROLES as readonly string[]).includes(role);
}

/**
 * True when a pathname requires an authenticated Supabase session.
 * Used by src/middleware.ts to redirect anonymous visitors to /sign-in.
 * Business pages themselves also re-check auth server-side (defence in depth).
 */
export function isProtectedRoute(pathname: string): boolean {
  const family = classifyRoute(pathname);
  return family === "business" || family === "platformAdmin";
}

/** Only owners may grant or revoke the `owner` role. */
export function canAssignRole(actorRole: string, targetRole: string): boolean {
  if (!isBusinessRole(targetRole)) return false; // no privileged/unknown roles ever
  if (targetRole === "owner") return actorRole === "owner";
  return MEMBERSHIP_MANAGER_ROLES.includes(actorRole as BusinessRole);
}

/** Only owners may remove another owner; nobody may remove themselves via the staff API. */
export function canRemoveMember(actorRole: string, targetRole: string, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (targetRole === "owner") return actorRole === "owner";
  return MEMBERSHIP_MANAGER_ROLES.includes(actorRole as BusinessRole);
}

/** Route families — used to reason about (and test) which audience a route serves. */
export const ROUTE_FAMILIES = {
  business: ["/dashboard", "/pos", "/products", "/orders", "/customers", "/expenses", "/reports", "/staff", "/storefront-settings", "/subscriptions", "/onboarding"],
  platformAdmin: ["/platform-admin"],
  customer: ["/track", "/cart", "/customer", "/s"],
} as const;

export function classifyRoute(pathname: string): "business" | "platformAdmin" | "customer" | "public" {
  if (ROUTE_FAMILIES.platformAdmin.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "platformAdmin";
  if (ROUTE_FAMILIES.customer.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "customer";
  if (ROUTE_FAMILIES.business.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "business";
  return "public";
}

/**
 * Validate a post-login redirect target. Blocks open redirects
 * (`//evil.com`, `/\evil.com`, absolute URLs) and API routes.
 */
export function sanitizeRedirect(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 300) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith("/api/")) return fallback;
  return next;
}

/**
 * Resolve a platform-admin login username to the Supabase Auth email it maps to.
 * Pure apart from the injected lookup, so it is unit-testable. A username alone
 * never grants access: the caller must still verify the password through
 * Supabase Auth AND confirm a `platform_admins` row for the resulting user.
 */
export async function resolveAdminEmail(
  username: string,
  lookup: (uname: string) => Promise<{ email: string | null } | null>,
): Promise<string | null> {
  const uname = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(uname)) return null;
  let row: { email: string | null } | null = null;
  try {
    row = await lookup(uname);
  } catch {
    return null;
  }
  const email = row?.email?.trim().toLowerCase() ?? null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
