-- SMARTFLOW migration: centralized SMS credit service (part 2: RLS + seed).
-- Run after 20261018000003_sms_credit_service.sql.

alter table public.sms_packages enable row level security;
alter table public.sms_balances enable row level security;
alter table public.sms_ledger enable row level security;
alter table public.sms_purchases enable row level security;
alter table public.sms_messages enable row level security;

drop policy if exists "anyone read active sms packages" on public.sms_packages;
create policy "anyone read active sms packages" on public.sms_packages
  for select using (is_active = true);
drop policy if exists "platform manage sms packages" on public.sms_packages;
create policy "platform manage sms packages" on public.sms_packages
  for all using (public.is_platform_admin());

drop policy if exists "members read sms balance" on public.sms_balances;
create policy "members read sms balance" on public.sms_balances
  for select using (public.is_member(business_id));
drop policy if exists "platform read sms balances" on public.sms_balances;
create policy "platform read sms balances" on public.sms_balances
  for select using (public.is_platform_admin());

drop policy if exists "members read sms ledger" on public.sms_ledger;
create policy "members read sms ledger" on public.sms_ledger
  for select using (public.is_member(business_id));
drop policy if exists "platform read sms ledger" on public.sms_ledger;
create policy "platform read sms ledger" on public.sms_ledger
  for select using (public.is_platform_admin());

drop policy if exists "members read sms purchases" on public.sms_purchases;
create policy "members read sms purchases" on public.sms_purchases
  for select using (public.is_member(business_id));
drop policy if exists "platform read sms purchases" on public.sms_purchases;
create policy "platform read sms purchases" on public.sms_purchases
  for select using (public.is_platform_admin());

drop policy if exists "members read sms messages" on public.sms_messages;
create policy "members read sms messages" on public.sms_messages
  for select using (public.is_member(business_id));
drop policy if exists "platform read sms messages" on public.sms_messages;
create policy "platform read sms messages" on public.sms_messages
  for select using (public.is_platform_admin());

-- Seed the initial package: 4 SMS for KSh 10 (admin can change later;
-- existing purchases retain their recorded terms in sms_purchases rows).
insert into public.sms_packages (name, credits, price_kes, is_active)
select 'Starter - 4 SMS', 4, 10, true
where not exists (select 1 from public.sms_packages where credits = 4 and price_kes = 10);

comment on table public.sms_packages is 'Admin-configured SMS credit packages. Purchases snapshot terms.';
comment on table public.sms_balances is 'Available SMS credits per business. Only mutated server-side via ledger.';
comment on table public.sms_ledger is 'Immutable SMS credit ledger. 1 credit = 1 GSM-7 segment equivalent.';
