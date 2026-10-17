# SMARTFLOW Architecture

## Overview
Multi-tenant SaaS. One codebase serves many independent businesses (tenants).
Each tenant = one row in `businesses`. Every tenant-owned row carries `business_id`.
Isolation enforced in Postgres RLS + server-side membership checks. Never trust
client-supplied `business_id` — always verify via `memberships`.

## Tenancy model
- `businesses` — tenant record (name, slug unique, type, currency default KES, timezone default Africa/Nairobi).
- `memberships` — (user_id, business_id, role). Roles: owner, manager, cashier, salesperson, stockkeeper, accountant, delivery, support.
- `branches` — outlets/warehouses belonging to a business.
- All domain tables (`products`, `customers`, `orders`, `expenses`, `suppliers`, ...) carry `business_id`.
- Platform admins live in `platform_admins` (user_id + role), separate from memberships.

## RLS strategy
- Enable RLS on every tenant table. `FOR ALL ... USING (is_member(business_id))`.
- Helper functions (SECURITY DEFINER, stable):
  - `is_member(bid uuid)` — auth.uid() in memberships for bid.
  - `has_role(bid uuid, roles text[])` — role check.
  - `is_platform_admin()` — auth.uid() in platform_admins.
- Platform tables (`subscription_plans`, `platform_settings`, `audit_logs` platform scope)
  allow read per policy, write only via service-role server handlers that re-check `is_platform_admin()`.
- Service role never shipped to browser. Browser uses anon key + RLS. Server handlers
  use service-role client only after verifying session + membership server-side.

## Money model (never conflate)
- `orders`: subtotal, discount_total, tax_total, total_due, amount_paid, payment_status, status.
- `payments`: individual money movements (cash, payhero, offline), each linked to order OR subscription_invoice — never both.
- `expenses`: operating costs, separate from COGS.
- Profit: gross = revenue(recognised sales) − COGS; net = gross − expenses. COGS from
  stock movements (avg-cost), not raw purchase totals.
- Subscription billing (`subscription_invoices`, `subscription_payments`) fully separate
  from customer order payments. Different PayHero channels.

## Stock model
- `stock_movements` append-only ledger: quantity_delta, unit_cost, reason, ref.
- Current stock = SUM(movements) per product/variant/branch. Never update a cached
  quantity without writing a movement row.
- Order fulfilment + PayHero callbacks idempotent via `idempotency_key` unique constraint.
- Cancel/restore guarded: only restore once (`stock_restored` flag on order).

## Request flow
Browser → Next.js App Router (RSC + server actions / route handlers) → Supabase.
Server handlers: validate (zod) → get session → check membership/role → query with
RLS-scoped client (user JWT) or service-role after check. PayHero/TOPSPEED/WhatsApp
calls only from server (`src/lib/*.ts`), callbacks verified with tokens.

## Subscriptions
- `subscription_plans` (editable tiers, thresholds, fees, grace days) — no hardcoded pricing in UI.
- `subscriptions` per business, `subscription_invoices` per period, payments via platform PayHero channel.
- Grace + suspension: `subscriptions.status`, access middleware checks status; data never deleted on expiry.

## Hosting
Vercel (frontend + server handlers), Supabase (DB/Auth/Storage/Edge). No VPS.
