-- SMARTFLOW migration 0001: tenancy foundation
-- businesses, memberships, branches, platform_admins + RLS helpers

create extension if not exists "pgcrypto";

-- Businesses (tenants)
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  business_type text not null default 'retail'
    check (business_type in ('retail','boutique','electronics','hardware','wholesale','restaurant','salon','cybercafe','services','other')),
  owner_user_id uuid references auth.users(id),
  phone text,
  email text,
  location text,
  logo_url text,
  currency text not null default 'KES',
  timezone text not null default 'Africa/Nairobi',
  settings jsonb not null default '{}'::jsonb,
  subscription_status text not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_businesses_owner on public.businesses(owner_user_id);
create index idx_businesses_slug on public.businesses(slug);

-- Memberships: user <-> business with role
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner','manager','cashier','salesperson','stockkeeper','accountant','delivery','support','customer')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index idx_memberships_user on public.memberships(user_id);
create index idx_memberships_business on public.memberships(business_id);

-- Branches / outlets / warehouses
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  location text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_branches_business on public.branches(business_id);

-- Platform admins (separate from business memberships)
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- RLS helpers
create or replace function public.is_member(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.business_id = bid and m.user_id = auth.uid());
$$;

create or replace function public.has_role(bid uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.business_id = bid and m.user_id = auth.uid() and m.role = any (roles));
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins p where p.user_id = auth.uid());
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_businesses_updated on public.businesses;
create trigger trg_businesses_updated before update on public.businesses
for each row execute function public.touch_updated_at();

-- Enable RLS
alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.branches enable row level security;
alter table public.platform_admins enable row level security;

-- Policies: members can read their business; owners/managers can update; create open to authenticated (onboarding creates business+membership server-side)
create policy "members read business" on public.businesses for select using (public.is_member(id));
create policy "owners update business" on public.businesses for update using (public.has_role(id, array['owner','manager']));
create policy "authenticated can create business" on public.businesses for insert with check (auth.role() = 'authenticated');
create policy "platform read businesses" on public.businesses for select using (public.is_platform_admin());

create policy "members read memberships" on public.memberships for select using (public.is_member(business_id));
create policy "owners manage memberships" on public.memberships for all using (public.has_role(business_id, array['owner','manager']) or public.is_platform_admin());

create policy "members read branches" on public.branches for select using (public.is_member(business_id));
create policy "staff manage branches" on public.branches for all using (public.has_role(business_id, array['owner','manager','stockkeeper']) or public.is_platform_admin());

create policy "platform admins read self" on public.platform_admins for select using (public.is_platform_admin());
