/**
 * PayHero integration (server-only). Never import from client components.
 *
 * REAL PROVIDER CONTRACT (verified Oct 2026 from Pay Hero Kenya developer docs
 * + official integration guide):
 * - Base: https://backend.payhero.co.ke/api/v2
 * - STK push: POST /payments/initiate-stk-push
 * - Auth: HTTP Basic over PAYHERO_API_USERNAME:PAYHERO_API_PASSWORD
 *   (the precomputed PAYHERO_BASIC_TOKEN may be used verbatim instead).
 * - Body: { amount, phone_number (2547XXXXXXXX), channel_id,
 *           provider ("m-pesa"), external_reference, callback_url? }
 * - Channels are registered in the PayHero dashboard (User Interface) — the API
 *   does NOT create Till/PayBill destinations. Sellers therefore configure
 *   their Till/PayBill number in SMARTFLOW; SMARTFLOW maps it to the centrally
 *   registered PayHero channel_id for that destination.
 *
 * Credentials are server-only env vars (see .env.example). Tests use the mock
 * below; production uses the real call only when credentials are present.
 */

/** Server-only PayHero env config (presence-checked, never logged). */
export type PayHeroConfig = {
  username: string;
  password: string;
  accountId: string;
  basicToken: string | null; // precomputed "Basic ..." value, optional
  baseUrl: string;
  callbackUrl: string | null;
};

/** Read-only presence check — safe to expose as booleans to the admin UI. */
export function payheroConfigStatus(): {
  configured: boolean;
  hasUsername: boolean;
  hasPasswordOrToken: boolean;
  hasAccountId: boolean;
  baseUrl: string;
} {
  const hasUsername = !!process.env.PAYHERO_API_USERNAME;
  const hasSecret = !!process.env.PAYHERO_API_PASSWORD || !!process.env.PAYHERO_BASIC_TOKEN;
  const hasAccountId = !!process.env.PAYHERO_ACCOUNT_ID;
  return {
    configured: hasUsername && hasSecret,
    hasUsername,
    hasPasswordOrToken: hasSecret,
    hasAccountId,
    baseUrl: process.env.PAYHERO_BASE_URL ?? "https://backend.payhero.co.ke/api/v2",
  };
}

function readPayHeroConfig(callbackUrl?: string): PayHeroConfig {
  const username = process.env.PAYHERO_API_USERNAME ?? "";
  const password = process.env.PAYHERO_API_PASSWORD ?? "";
  const basicToken = process.env.PAYHERO_BASIC_TOKEN ?? null;
  const accountId = process.env.PAYHERO_ACCOUNT_ID ?? "";
  if (!username || (!password && !basicToken)) {
    throw new Error("PayHero not configured: set PAYHERO_API_USERNAME and PAYHERO_API_PASSWORD (or PAYHERO_BASIC_TOKEN)");
  }
  return {
    username,
    password,
    accountId,
    basicToken,
    baseUrl: process.env.PAYHERO_BASE_URL ?? "https://backend.payhero.co.ke/api/v2",
    callbackUrl: callbackUrl ?? process.env.PAYHERO_CALLBACK_URL ?? null,
  };
}

export type PayHeroInitArgs = {
  amount: number;
  phone: string; // 2547XXXXXXXX (no plus)
  channelId: string;
  reference: string; // our idempotency key → external_reference
  callbackUrl: string;
};

export type PayHeroInitResult = {
  provider_ref: string | null;
  raw?: unknown;
};

/**
 * Real PayHero STK initiation (v2 contract). Throws when not configured or on
 * provider HTTP failure so callers can keep the attempt pending for reconcile.
 */
export async function payheroInitiateSTKReal(args: PayHeroInitArgs): Promise<PayHeroInitResult> {
  const cfg = readPayHeroConfig(args.callbackUrl);
  const auth =
    cfg.basicToken && cfg.basicToken.startsWith("Basic ")
      ? cfg.basicToken
      : `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`;
  const body: Record<string, unknown> = {
    amount: args.amount,
    phone_number: args.phone,
    channel_id: Number.isNaN(Number(args.channelId)) ? args.channelId : Number(args.channelId),
    provider: "m-pesa",
    external_reference: args.reference,
  };
  if (args.callbackUrl) body.callback_url = args.callbackUrl;
  const res = await fetch(`${cfg.baseUrl}/payments/initiate-stk-push`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayHero STK failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json().catch(() => ({}))) as {
    provider_ref?: string | null;
    reference?: string;
    CheckoutRequestID?: string;
    ResponseDescription?: string;
  };
  return {
    provider_ref: json.provider_ref ?? json.CheckoutRequestID ?? json.reference ?? null,
    raw: json,
  };
}

/**
 * Mock provider used by tests and local development. Returns a deterministic
 * ref so idempotency can be exercised without live credentials.
 */
export async function payheroInitiateSTKMock(args: PayHeroInitArgs): Promise<PayHeroInitResult> {
  return { provider_ref: `MOCK-${args.reference}` };
}

/** Select the real provider when credentials are present, else the mock. */
export function payheroInitiateSTK(args: PayHeroInitArgs): Promise<PayHeroInitResult> {
  const st = payheroConfigStatus();
  if (st.configured) return payheroInitiateSTKReal(args);
  return payheroInitiateSTKMock(args);
}

/**
 * Verify a PayHero callback. The shared secret must match PAYHERO_CALLBACK_TOKEN.
 * Returns false when no token is configured or the check fails.
 */
export function verifyPayHeroCallback(req: Request): boolean {
  const token = process.env.PAYHERO_CALLBACK_TOKEN;
  if (!token) return false;
  const provided =
    req.headers.get("x-payhero-token") ??
    req.headers.get("payhero-token") ??
    new URL(req.url).searchParams.get("token");
  if (!provided || provided !== token) return false;
  return true;
}