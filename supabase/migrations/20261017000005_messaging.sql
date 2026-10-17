-- SMARTFLOW migration 0004b: messaging, storefront, audit
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  channel text not null,
  template text,
  body text not null,
  recipient text not null,
  status text not null default 'queued',
  provider_ref text,
  created_at timestamptz not null default now()
);
create index idx_messages_business on public.messages(business_id);

create table public.storefronts (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  is_published boolean not null default false,
  hero_text text,
  policies jsonb not null default '{}'::jsonb,
  delivery_fee numeric(12,2) not null default 0,
  whatsapp_number text,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_business on public.audit_logs(business_id, created_at desc);

alter table public.messages enable row level security;
alter table public.storefronts enable row level security;
alter table public.audit_logs enable row level security;

create policy "members read messages" on public.messages for select using (business_id is null or public.is_member(business_id));
create policy "staff send messages" on public.messages for insert with check (business_id is null or public.has_role(business_id, array['owner','manager','cashier','salesperson']) or public.is_platform_admin());
create policy "public read published storefronts" on public.storefronts for select using (is_published = true or public.is_member(business_id) or public.is_platform_admin());
create policy "owners manage storefront" on public.storefronts for all using (public.has_role(business_id, array['owner','manager']) or public.is_platform_admin());
create policy "members read audit" on public.audit_logs for select using ((business_id is not null and public.has_role(business_id, array['owner','manager','accountant'])) or public.is_platform_admin());
