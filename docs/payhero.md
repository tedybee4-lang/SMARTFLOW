# PayHero integration (only permitted provider)

Official docs: https://docs.payhero.co.ke/ — verify endpoints/auth before going live.
Do NOT invent endpoints. Structure below is ready; credentials via server env only.

## Two separated purposes
1. **Subscription payments** (business → SMARTFLOW platform): use platform channel
   (`PAYHERO_PLATFORM_CHANNEL_ID`), linked to `subscription_invoices`.
2. **Order payments** (customer → business): use that business's channel
   (`business_payment_channels`), linked to `orders`.

## Required flow (server-only)
- Initiate STK from Next.js route handler (`/api/payments/...`): validate amount vs
  invoice/order total, store `payment_attempts` row with idempotency key, call PayHero,
  store provider reference.
- Callback handler: verify `PAYHERO_CALLBACK_TOKEN`/signature per official docs,
  validate amount + channel + reference + current state, update records idempotently
  (unique constraint on provider ref / idempotency key), reconcile via status query.
- Never mark paid on browser redirect. Handle pending/success/failed/expired/reversed.
- Tests use mocked PayHero responses, clearly marked test-only.

## Pending verification (needs account + docs check)
- Exact auth headers, STK endpoint, callback signing, status-query endpoint.
- Update `src/lib/payhero.ts` + this doc after reading live official docs.
