/**
 * Non-secret platform settings (server-only). Reads platform_settings first,
 * falls back to env vars (env remains the fallback at runtime per migration
 * 20261018000005). SECRETS are NEVER stored in platform_settings — they stay
 * in env only.
 */
import { supabaseServiceRole } from "@/lib/supabase-server";

const ENV_FALLBACK: Record<string, string | undefined> = {
  payhero_platform_channel_id: process.env.PAYHERO_PLATFORM_CHANNEL_ID,
  payhero_sms_channel_id: process.env.PAYHERO_SMS_CHANNEL_ID,
  topspeed_sender_id: process.env.TOPSPEED_SENDER_ID,
  topspeed_base_url: process.env.TOPSPEED_API_URL,
};

/** Fetch one setting by key; empty/missing DB values fall back to env. Never throws. */
export async function getPlatformSetting(key: string): Promise<string> {
  try {
    const srv = supabaseServiceRole();
    const { data } = await srv.from("platform_settings").select("value").eq("key", key).maybeSingle();
    const dbVal = ((data as { value: string } | null)?.value ?? "").trim();
    if (dbVal) return dbVal;
  } catch {
    // Table may not exist yet (migrations pending) — env fallback below.
  }
  return (ENV_FALLBACK[key] ?? "").trim();
}

/** Resolve the PayHero channel for SMS purchases: env first, then platform_settings. */
export async function resolveSmsChannelId(): Promise<string> {
  const env = (process.env.PAYHERO_PLATFORM_CHANNEL_ID ?? process.env.PAYHERO_SMS_CHANNEL_ID ?? "").trim();
  if (env) return env;
  const db = await getPlatformSetting("payhero_platform_channel_id");
  if (db) return db;
  return getPlatformSetting("payhero_sms_channel_id");
}

/**
 * Resolve the central platform PayHero channel (business → SMARTFLOW payments:
 * subscriptions, and platform test pushes). Env first, then platform_settings.
 * Unlike resolveSmsChannelId this NEVER falls back to the SMS-only channel so a
 * subscription can never be collected through an SMS destination.
 */
export async function resolvePlatformChannelId(): Promise<string> {
  const env = (process.env.PAYHERO_PLATFORM_CHANNEL_ID ?? "").trim();
  if (env) return env;
  return getPlatformSetting("payhero_platform_channel_id");
}
