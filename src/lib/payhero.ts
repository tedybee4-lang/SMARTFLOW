/** PayHero integration skeleton (server-only).
 * Fill in exact endpoints/auth from https://docs.payhero.co.ke/ before going live.
 * Never import this file from client components.
 */
export type PayHeroInitArgs = {
  amount: number;
  phone: string; // 2547XXXXXXXX
  channelId: string;
  reference: string; // our idempotency key
  callbackUrl: string;
};

export async function payheroInitiateSTK(_args: PayHeroInitArgs) {
  throw new Error(
    "PayHero not configured: verify auth + STK endpoint at https://docs.payhero.co.ke/ and set PAYHERO_* env vars.",
  );
}

export function verifyPayHeroCallback(_req: Request): boolean {
  const token = process.env.PAYHERO_CALLBACK_TOKEN;
  if (!token) return false;
  // TODO: implement exact verification per official docs (signature/header check).
  return false;
}
