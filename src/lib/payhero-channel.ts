/**
 * Tenant-safe PayHero channel resolution (server-only).
 *
 * The PayHero channel a payment is collected through is SERVER-owned data:
 *  - "order" payments (customer → business) MUST use the channel configured on
 *    that business' own `business_payment_channels` row.
 *  - "subscription"/"sms" payments (business → platform) MUST use the centrally
 *    configured platform channel.
 *
 * A client-supplied `channel_id` is NEVER trusted: it is only ever a hint that
 * is compared against the server-resolved value. Resolving it here keeps the
 * STK route, the callback route and every consumer consistent.
 */
import { supabaseServiceRole } from "@/lib/supabase-server";
import { resolvePlatformChannelId, resolveSmsChannelId } from "@/lib/platform-settings";

export type StkPurpose = "order" | "subscription" | "sms" | "platform";

export type ChannelResolution =
  | { ok: true; channelId: string; source: "business" | "platform" }
  | { ok: false; error: string; status: number };

type ChannelRow = {
  provider: string | null;
  payment_method: string | null;
  channel_id: string | null;
  is_active: boolean | null;
};

/**
 * Resolve the PayHero channel owned by ONE business. The lookup is scoped to
 * `business_id`, so a channel belonging to another tenant can never be used.
 */
export async function resolveBusinessChannelId(businessId: string): Promise<ChannelResolution> {
  const srv = supabaseServiceRole();
  const { data } = await srv
    .from("business_payment_channels")
    .select("provider,payment_method,channel_id,is_active")
    .eq("business_id", businessId)
    .maybeSingle();
  const row = data as ChannelRow | null;
  if (!row) {
    return { ok: false, error: "This business has no PayHero channel configured yet.", status: 409 };
  }
  if (row.is_active === false) {
    return { ok: false, error: "M-Pesa payments are disabled for this business.", status: 409 };
  }
  if (row.provider && row.provider !== "payhero") {
    return { ok: false, error: "M-Pesa STK payments are not enabled for this business.", status: 409 };
  }
  // payment_method is null on rows created before Till/PayBill existed - those
  // were PayHero-only businesses, so a present channel_id still means PayHero.
  const method = row.payment_method ?? (row.channel_id ? "payhero" : null);
  if (method !== "payhero") {
    return { ok: false, error: "M-Pesa STK payments are not enabled for this business.", status: 409 };
  }
  const channelId = (row.channel_id ?? "").trim();
  if (!channelId) {
    return { ok: false, error: "This business has no PayHero channel configured yet.", status: 409 };
  }
  return { ok: true, channelId, source: "business" };
}

/**
 * Resolve the channel for a payment purpose:
 *  - "order"       → the business' own channel (customer pays the business).
 *  - "subscription"→ the platform channel (business pays SMARTFLOW).
 *  - "sms"         → the platform channel (central SMS credit purchase).
 */
export async function resolveChannelForPurpose(args: {
  purpose: StkPurpose;
  businessId: string | null;
}): Promise<ChannelResolution> {
  if (args.purpose === "order") {
    if (!args.businessId) {
      return { ok: false, error: "business_id is required for order payments.", status: 400 };
    }
    return resolveBusinessChannelId(args.businessId);
  }
  // "sms" has its own central destination; "subscription"/"platform" use the
  // platform channel and must NEVER fall back to the SMS-only channel.
  // `?? ""` guards against a null from the settings layer so a missing config
  // surfaces as a clean 503 instead of an unhandled 500.
  const channelId =
    args.purpose === "sms"
      ? ((await resolveSmsChannelId()) ?? "").trim()
      : ((await resolvePlatformChannelId()) ?? "").trim();
  if (!channelId) {
    return { ok: false, error: "Payments are not configured yet - contact support.", status: 503 };
  }
  return { ok: true, channelId, source: "platform" };
}

/**
 * Compare a client-supplied channel hint with the server-resolved channel.
 * A mismatch is a cross-tenant attempt (or a stale client) — refuse it.
 */
export function channelMatches(resolved: string, requested: string | undefined | null): boolean {
  const hint = (requested ?? "").trim();
  if (!hint) return true; // no hint supplied — the server value wins.
  return hint === resolved.trim();
}
