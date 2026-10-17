# Implementation Status (live)

Updated: 2026-10-18 01:50 EAT. Supabase (ref wmszgwrqwlhrfolkwwsn) + Vercel project linked, production publicly serving at https://smartflow-malariachrome-7756s-projects.vercel.app. All migrations applied remotely (40 RLS policies, 4 subscription tiers seeded).

## Verified green (this session)
- Tests: 15/15 passing (core 8 + security/lifecycle 7)
- Typecheck: passing. Lint: 0 errors. Production build: 18 routes, passing.
- Live probes: `/`, `/sign-in`, `/onboarding`, `/dashboard` (auth-gated), `/platform-admin` (guarded) all render correctly; `/s/[slug]` graceful 404 on empty DB.

## Completed this session
- Security hardening pass:
  - **Price-tampering fix** — `/api/sales/checkout` now re-verifies every unit price against the server catalogue (409 on mismatch). Client prices are never trusted.
  - Rate limiting (`src/lib/rate-limit.ts`, in-memory per-IP) on checkout (30/min), storefront checkout (20/min), onboarding (10/min).
  - Product availability check before order creation (all-or-nothing).
- Customer order tracking: `/track` page + `/api/storefront/track` (phone + optional order-no lookup; only that phone's orders returned, rate-limited).
- Platform admin page expanded: live subscription-tier table, business roster with status, recent audit events (service-role reads, admin-guarded).
- Deployment: `vercel.json` framework pin (fixed "Other"-preset build failures), env vars set on Vercel (Supabase URL/anon/service-role), SSO protection disabled by user → production public.

## Completed (foundation through phases)
- Next.js 16 + TS + Tailwind in `smartflow/`; `cacheComponents` disabled for authenticated dynamic routes
- Supabase clients (browser/server/service-role split), Kenya helpers, money math + tests, auth guards
- Migrations (timestamped, applied remotely): tenancy, catalogue/inventory, orders/payments, billing (RLS-hardened), messaging/storefront/audit — all with RLS
- Pages: home, /sign-in, /onboarding (3-step), /dashboard (real queries), /platform-admin (guarded), /products, /pos, /orders, /expenses, /cart, /track, public /s/[slug]
- APIs: onboarding, sales/checkout, storefront/checkout, storefront/track, orders/transition (7 transitions, guarded stock restore), subscriptions/invoice (qualifying-sales tier calc, Starter KSh 4,000 preserved), payments/payhero-callback (token check, amount validation, idempotent, dual-purpose)
- PayHero / TOPSPEED SMS / WhatsApp server-only skeletons (docs-first, no invented endpoints)
- CI: GitHub Actions (lint, typecheck, test, build); pushed to `tedybee4-lang/SMARTFLOW` main

## Next
- PayHero STK-push initiation endpoint per official docs (payment_attempts rows, idempotency)
- Real TOPSPEED SMS + WhatsApp Cloud API wiring once credentials arrive
- Platform-admin invoice/tier-assignment management UI
- Seed a demo business + storefront to end-to-end verify /s/[slug] and /track with real data

## Needs user (nothing else blocked)
- PayHero / TOPSPEED / WhatsApp credentials via official dashboards (must not be fabricated)
