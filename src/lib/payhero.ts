/**
 * PayHero integration (server-only).
 *
 * The real provider call lives in `payheroInitiateSTK`. It is injected so the
 * route can be unit-tested without credentials: tests pass a mock that returns
 * a provider ref, and production passes the real implementation.
 *
 * Never import this file from client components.
 */
export type PayHeroInitArgs = {
  amount: number;
  phone: string; // 2547XXXXXXXX (no plus)
  channelId: string;
  reference: string; // our idempotency key
  callbackUrl: string;
};

export type PayHeroInitResult = {
  provider_ref: string | null;
  raw?: unknown;
};

/**
 * Real PayHero STK initiation.
 * Requires PAYHERO_CONSUMER_KEY + PAYHERO_CONSUMER_SECRET + PAYHERO_* env vars.
 * Throws when not configured so callers can fall back to a mock.
 */
export async function payheroInitiateSTKReal(args: PayHeroInitArgs): Promise<PayHeroInitResult> {
  const consumerKey = process.env.PAYHERO_CONSUMER_KEY;
  const consumerSecret = process.env.PAYHERO_CONSUMER_SECRET;
  const baseUrl = process.env.PAYHERO_BASE_URL ?? "https://api.payhero.co.ke";
  if (!consumerKey || !consumerSecret) {
    throw new Error("PayHero not configured: set PAYHERO_CONSUMER_KEY and PAYHERO_CONSUMER_SECRET");
  }
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await fetch(`${baseUrl}/api/v1/payments/stkpush`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: args.amount,
      phone_number: args.phone,
      channel_id: args.channelId,
      reference: args.reference,
      callback_url: args.callbackUrl,
    }),
  });
  if (!res.ok) {
    throw new Error(`PayHero STK failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { provider_ref?: string | null; reference?: string };
  return { provider_ref: json.provider_ref ?? null, raw: json };
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
  if (process.env.PAYHERO_CONSUMER_KEY && process.env.PAYHERO_CONSUMER_SECRET) {
    return payheroInitiateSTKReal(args);
  }
  return payheroInitiateSTKMock(args);
}

/**
 * Verify a PayHero callback. Per the official docs the callback carries a
 * token/header that must match the configured PAYHERO_CALLBACK_TOKEN.
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