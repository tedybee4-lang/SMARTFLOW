# Implementation Status (live)

Updated: 2026-10-18 02:45 EAT. Supabase (ref wmszgwrqwlhrfolkwwsn) + Vercel project linked, production publicly serving at https://smartflow-malariachrome-7756s-projects.vercel.app. All migrations applied remotely (40 RLS policies, 4 subscription tiers seeded).

## Verified green (this session)
- Tests: 15/15 passing (core 8 + security/lifecycle 7)
- Typecheck: passing. Lint: 0 errors. Production build: 21 routes, passing.
- Local prod-server probes: `/`, `/sign-in`, `/onboarding`, `/track`, `/cart?shop=test`, `/s/unknown`, `/dashboard`, `/pos`, `/products`, `/orders`, `/expenses`, `/subscriptions`, `/platform-admin` all render 200 with a stylesheet `<link>`; served CSS (38 KB) contains the design tokens and component classes.
- Live probes: `/`, `/sign-in`, `/onboarding`, `/dashboard` (auth-gated), `/platform-admin` (guarded) all render correctly; `/s/[slug]` graceful 404 on empty DB.

## Completed this session
- **CSS root-cause fix + full UI redesign**:
  - **Root cause** — production served unstyled HTML because Tailwind v4 was installed but never wired into the build. `globals.css` had the correct `@import "tailwindcss"` but no PostCSS config and no Turbopack loader existed, so zero utilities were ever generated (built CSS contained only the raw `body{font-family}` rule, ~400 bytes).
  - **Fix** — `next.config.ts` now wires `@tailwindcss/turbopack` via `turbopack.rules` (`"*\.css": [{ loader: "@tailwindcss/turbopack" }]`), per Next.js 16 bundled docs. Built CSS went 400 B → 38 KB with real utilities.
  - **Tailwind v4 constraint** — v4 forbids `@apply`-ing custom component classes; `globals.css` therefore inlines the shared base into grouped selectors (`.btn, .btn-primary, …`).
  - **Design system** — `globals.css` `@theme`: navy-600…950 tokens, font stack, base focus/selection states; component classes: `.btn-primary/navy/outline/ghost/danger`, `.input`, `.label`, `.card`, `.card-pad`, `.table-base`, `.badge-*`, `.page-title`, `.page-sub`, `.num`. Navy/blue/violet brand; green only as semantic "paid/ok" badge, never a primary color.
  - **Route groups** — `(marketing)/` (home, sign-in, onboarding, track, cart, s/[slug]; public header + footer) and `(app)/` (dashboard, pos, products, orders, expenses, subscriptions, platform-admin; sidebar + header shell with active-link highlighting, mobile drawer, admin-gated Platform section via real `isPlatformAdmin()`).
  - **Page redesigns** — marketing hero landing with features/steps/CTA; split-panel sign-in; true 3-step onboarding wizard (progress bar, per-step validation, review step; same `/api/onboarding` contract); POS two-pane (product grid + sticky cart with qty controls, cash/credit); products table + inline add form; orders with status/payment badges; expenses list + quick-add; new `/subscriptions` page (real subscription, plans, invoices via RLS-scoped reads); storefront hero + product cards with CTA to `/cart`; cart with steppers/fulfilment toggle; track with labelled progress bars and Paid/Balance-due badge; platform-admin stat cards + tables. All business logic, API contracts and authz preserved verbatim.
  - Verified locally with `next start`: all routes 200, every HTML links the stylesheet, fetched CSS contains `--color-navy-900` and `.btn-primary`.
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
