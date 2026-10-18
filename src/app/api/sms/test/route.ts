import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/lib/auth";
import { rateLimited } from "@/lib/rate-limit";
import { SmsTestSchema } from "@/lib/validation";
import { normalizeKEPhone, toSTKFormat } from "@/lib/kenya";
import { topspeedConfigStatus, sendSMS } from "@/lib/messaging";

/**
 * POST /api/sms/test — platform-admin SMS test console.
 * Uses the central TOPSPEED credentials, NEVER bills a business ledger.
 * Free-form send allowed here only (admin testing); business sends go via
 * /api/sms/send with credit accounting.
 */
export async function POST(req: Request) {
  const rl = rateLimited(req, 10);
  if (rl) return rl;
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  const parsed = SmsTestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const to = normalizeKEPhone(parsed.data.to);
  const stk = toSTKFormat(parsed.data.to);
  if (!to || !stk) {
    return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });
  }
  const cfg = topspeedConfigStatus();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "TOPSPEED not configured — set TOPSPEED_API_KEY server-side.", configured: false },
      { status: 503 },
    );
  }
  const res = await sendSMS(to, parsed.data.message);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error ?? "Test send failed", configured: true },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, to, provider_ref: res.provider_ref, billed: false });
}

/** GET /api/sms/test — central SMS config presence (booleans only, never secrets). */
export async function GET() {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }
  return NextResponse.json({ sms: topspeedConfigStatus() });
}
