-- SMARTFLOW migration: centralized SMS credit service (part 1: tables).
-- Businesses buy SMS credit packages via PayHero; sends debit a durable ledger.
-- Provider: TOPSPEED via shared central credentials (ispledger endpoint).
-- 4 SMS for KSh 10 is seeded as the initial package (admin-configurable).

create table if not exists public.sms_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits int not null check (credits > 0),
  price_kes numeric(12,2) not null check (price_kes >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sms_balances (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.sms_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('purchase','send_debit','send_refund','adjustment','reserve','release')),
  credits int not null,
  package_id uuid references public.sms_packages(id) on delete set null,
  payment_attempt_id uuid,
  message_id uuid,
  idempotency_key text unique not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_sms_ledger_business on public.sms_ledger(business_id, created_at desc);

create table if not exists public.sms_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  package_id uuid not null references public.sms_packages(id),
  credits int not null,
  price_kes numeric(12,2) not null,
  payment_attempt_id uuid,
  status text not null default 'pending' check (status in ('pending','completed','failed','cancelled','expired')),
  idempotency_key text unique not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_sms_purchases_business on public.sms_purchases(business_id, created_at desc);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  recipient text not null,
  body text not null,
  segments int not null default 1 check (segments >= 1),
  credits_charged int not null default 1 check (credits_charged >= 0),
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed')),
  provider_ref text,
  provider_error text,
  idempotency_key text unique not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_sms_messages_business on public.sms_messages(business_id, created_at desc);

alter table public.payment_attempts
  add column if not exists sms_purchase_id uuid references public.sms_purchases(id) on delete set null;

alter table public.payment_attempts drop constraint if exists payment_attempts_purpose_check;
alter table public.payment_attempts
  add constraint payment_attempts_purpose_check
  check (purpose in ('order','subscription','sms','platform'));
