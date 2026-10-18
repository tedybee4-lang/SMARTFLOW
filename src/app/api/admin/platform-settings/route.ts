import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/lib/auth";
import { supabaseServiceRole } from "@/lib/supabase-server";
import { rateLimited } from "@/lib/rate-limit";
import { getPlatformSetting } from "@/lib/platform-settings";

/**
 * GET /api/admin/platform-settings — non-secret operational settings only
 * (channel IDs, sender ID, base URL). SECRETS (API keys, passwords, tokens)
 * are NEVER stored in platform_settings and never returned by this route.
 */
export async function GET() {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  const keys = ["payhero_platform_channel_id", "payhero_sms_channel_id", "topspeed_sender_id", "topspeed_base_url"];
  const srv = supabaseServiceRole();
  const { data } = await srv.from("platform_settings").select("key,value");
  const rows = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const settings: Record<string, string> = {};
  for (const k of keys) {
    settings[k] = (rows.get(k) ?? "").trim() || (await getPlatformSetting(k));
  }
  return NextResponse.json({ settings });
}

/**
 * PUT /api/admin/platform-settings — update whitelisted non-secret keys.
 * Body: { settings: { key: value, ... } }. Unknown keys are rejected so
 * secrets can never be smuggled into this table.
 */
export async function PUT(req: Request) {
  const rl = rateLimited(req, 20);
  if (rl) return rl;
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { settings?: Record<string, unknown> } | null;
  const allowed = new Set(["payhero_platform_channel_id", "payhero_sms_channel_id", "topspeed_sender_id", "topspeed_base_url"]);
  const entries = Object.entries(body?.settings ?? {}).filter(([k]) => allowed.has(k));
  if (entries.length === 0) {
    return NextResponse.json({ error: "No valid settings to update" }, { status: 400 });
  }
  const srv = supabaseServiceRole();
  for (const [key, value] of entries) {
    const { error } = await srv.from("platform_settings").upsert(
      { key, value: String(value ?? "").trim(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) return NextResponse.json({ error: `Could not update ${key}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated: entries.map(([k]) => k) });
}