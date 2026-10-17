-- SMARTFLOW migration 0003: customers, orders, payments (customer money), expenses
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  user_id uuid references auth.users(id),
  credit_balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index idx_customers_business on public.customers(business_id);
create index idx_customers_phone on public.customers(business_id, phone);

-- Orders: lifecycle placed → payment_pending/payment_confirmed → processing → ready/dispatched → delivered; plus cancelled/failed/refunded
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  order_no text not null,
  status text not null default 'placed',
  payment_status text not null default 'unpaid',
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total_due numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  fulfillment text not null default 'pickup',
  delivery_fee numeric(12,2) not null default 0,
  notes text,
  stock_deducted boolean not null default false,
  stock_restored boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, order_no)
);
create index idx_orders_business on public.orders(business_id);
create index idx_orders_status on public.orders(business_id, status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name_snapshot text not null,
  qty numeric(12,2) not null,
  unit_price numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  line_total numeric(12,2) not null
);
create index idx_items_order on public.order_items(order_id);

drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated before update on public.orders
for each row execute function public.touch_updated_at();

-- Customer-order payments (cash, payhero, offline). order_id set; subscription_invoice_id null.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  subscription_invoice_id uuid, -- FK added in 0004
  method text not null, -- cash, payhero, offline, credit
  amount numeric(12,2) not null check (amount > 0),
  provider_ref text,
  channel_id text,
  status text not null default 'completed',
  idempotency_key text unique,
  received_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index idx_payments_order on public.payments(order_id);
create index idx_payments_business on public.payments(business_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  category text not null,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  spent_at date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index idx_expenses_business on public.expenses(business_id, spent_at);

alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;

create policy "members read customers" on public.customers for select using (public.is_member(business_id));
create policy "staff manage customers" on public.customers for all using (public.has_role(business_id, array['owner','manager','cashier','salesperson']) or public.is_platform_admin());

create policy "members read orders" on public.orders for select using (public.is_member(business_id));
create policy "staff manage orders" on public.orders for all using (public.has_role(business_id, array['owner','manager','cashier','salesperson','delivery']) or public.is_platform_admin());

create policy "members read items" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and public.is_member(o.business_id))
);
create policy "staff manage items" on public.order_items for all using (
  exists (select 1 from public.orders o where o.id = order_id and (public.has_role(o.business_id, array['owner','manager','cashier','salesperson']) or public.is_platform_admin()))
);

create policy "members read payments" on public.payments for select using (public.is_member(business_id));
create policy "staff record payments" on public.payments for insert with check (public.has_role(business_id, array['owner','manager','cashier','accountant']) or public.is_platform_admin());
create policy "staff update payments" on public.payments for update using (public.has_role(business_id, array['owner','manager','accountant']) or public.is_platform_admin());

create policy "members read expenses" on public.expenses for select using (public.is_member(business_id));
create policy "staff manage expenses" on public.expenses for all using (public.has_role(business_id, array['owner','manager','accountant']) or public.is_platform_admin());
