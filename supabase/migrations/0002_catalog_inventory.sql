-- SMARTFLOW migration 0002: catalogue, inventory, suppliers
-- Depends on 0001 (businesses, branches, memberships).

-- Categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_categories_business on public.categories(business_id);

-- Products / services
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  kind text not null default 'product' check (kind in ('product','service')),
  sku text,
  barcode text,
  unit text not null default 'pcs',
  cost_price numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  wholesale_price numeric(12,2),
  tax_rate numeric(5,4) not null default 0,
  track_stock boolean not null default true,
  low_stock_threshold numeric(12,2) not null default 5,
  photo_url text,
  attributes jsonb not null default '{}'::jsonb, -- variants, serials, warranty, batch/expiry
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_products_business on public.products(business_id);
create index idx_products_barcode on public.products(business_id, barcode);

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated before update on public.products
for each row execute function public.touch_updated_at();

-- Suppliers
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index idx_suppliers_business on public.suppliers(business_id);

-- Purchase orders + goods received
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  status text not null default 'draft',
  total numeric(12,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index idx_po_business on public.purchase_orders(business_id);

-- Append-only stock ledger. Current stock = SUM(quantity_delta).
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  quantity_delta numeric(12,2) not null,
  unit_cost numeric(12,2) not null default 0,
  reason text not null, -- purchase, sale, adjustment, transfer_in, transfer_out, damage, expiry, return, refund_restore
  ref_type text,
  ref_id uuid,
  idempotency_key text unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index idx_stock_product on public.stock_movements(product_id);
create index idx_stock_business on public.stock_movements(business_id);

-- RLS
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.stock_movements enable row level security;

create policy "members read categories" on public.categories for select using (public.is_member(business_id));
create policy "staff manage categories" on public.categories for all using (public.has_role(business_id, array['owner','manager','stockkeeper','cashier']) or public.is_platform_admin());

create policy "members read products" on public.products for select using (public.is_member(business_id));
create policy "staff manage products" on public.products for all using (public.has_role(business_id, array['owner','manager','stockkeeper','cashier']) or public.is_platform_admin());

create policy "members read suppliers" on public.suppliers for select using (public.is_member(business_id));
create policy "staff manage suppliers" on public.suppliers for all using (public.has_role(business_id, array['owner','manager','stockkeeper','accountant']) or public.is_platform_admin());

create policy "members read po" on public.purchase_orders for select using (public.is_member(business_id));
create policy "staff manage po" on public.purchase_orders for all using (public.has_role(business_id, array['owner','manager','stockkeeper']) or public.is_platform_admin());

create policy "members read stock" on public.stock_movements for select using (public.is_member(business_id));
create policy "staff write stock" on public.stock_movements for insert with check (public.has_role(business_id, array['owner','manager','stockkeeper','cashier']) or public.is_platform_admin());
create policy "platform read stock" on public.stock_movements for select using (public.is_platform_admin());
