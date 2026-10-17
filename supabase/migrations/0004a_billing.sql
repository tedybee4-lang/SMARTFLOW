-- SMARTFLOW migration 0004a: subscriptions + business channels
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  max_qualifying_sales numeric(12,2),
  fee numeric(12,2) not null,
  grace_days int not null default 7,
  is_custom boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade unique,
  plan_id uuid references public.subscription_plans(id),
  status text not null default 'trial',
  current_period_start date,
  current_period_end date,
  qualifying_sales numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  period_start date not null,
  period_end date not null,
  qualifying_sales numeric(12,2) not null default 0,
  amount numeric(12,2) not null,
  status text not null default 'unpaid',
  due_date date,
  created_at timestamptz not null default now()
);
create index idx_subinv_business on public.subscription_invoices(business_id);

alter table public.payments add constraint fk_payments_subinv
  foreign key (subscription_invoice_id) references public.subscription_invoices(id) on delete set null;

insert into public.subscription_plans (name, max_qualifying_sales, fee) values
  ('Starter (0-50k)', 50000, 4000),
  ('Growth (50k-200k)', 200000, 6000),
  ('Scale (200k-500k)', 500000, 9000),
  ('Pro (500k-1M)', 1000000, 12000);

create table public.business_payment_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade unique,
  provider text not null default 'payhero',
  channel_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  subscription_invoice_id uuid references public.subscription_invoices(id) on delete set null,
  purpose text not null check (purpose in ('order','subscription')),
  channel_id text not null,
  amount numeric(12,2) not null,
  phone text,
  provider_ref text,
  status text not null default 'initiated',
  idempotency_key text unique not null,
  raw_callback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_attempts_ref on public.payment_attempts(provider_ref);

alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.business_payment_channels enable row level security;
alter table public.payment_attempts enable row level security;

create policy "anyone read active plans" on public.subscription_plans for select using (is_active = true);
create policy "platform manage plans" on public.subscription_plans for all using (public.is_platform_admin());
create policy "members read subscription" on public.subscriptions for select using (public.is_member(business_id));
create policy "platform manage subscriptions" on public.subscriptions for all using (public.is_platform_admin());
create policy "members read sub invoices" on public.subscription_invoices for select using (public.is_member(business_id));
create policy "platform manage sub invoices" on public.subscription_invoices for all using (public.is_platform_admin());
create policy "members read channels" on public.business_payment_channels for select using (public.is_member(business_id));
create policy "owners manage channels" on public.business_payment_channels for all using (public.has_role(business_id, array['owner','manager']) or public.is_platform_admin());
create policy "members read attempts" on public.payment_attempts for select using (public.is_member(business_id));
create policy "platform read attempts" on public.payment_attempts for select using (public.is_platform_admin());
