-- SMARTFLOW migration 0008: business Till & PayBill payment settings
-- Owners configure HOW customers pay them: M-Pesa Till, PayBill, or a
-- PayHero channel for STK push. Exactly one target must match the chosen
-- payment_method (enforced below).

alter table public.business_payment_channels
  add column if not exists till_number text,
  add column if not exists paybill_number text,
  add column if not exists payment_method text
    check (payment_method in ('till', 'paybill', 'payhero'));

-- channel_id was mandatory for STK-only use; Till/PayBill-only businesses
-- legitimately have no PayHero channel yet.
alter table public.business_payment_channels alter column channel_id drop not null;

-- The chosen method must have its own target populated.
alter table public.business_payment_channels drop constraint if exists chk_payment_channel_target;
alter table public.business_payment_channels
  add constraint chk_payment_channel_target check (
    payment_method is null
    or (payment_method = 'till'    and till_number   is not null and btrim(till_number) <> '')
    or (payment_method = 'paybill' and paybill_number is not null and btrim(paybill_number) <> '')
    or (payment_method = 'payhero' and channel_id     is not null and btrim(channel_id) <> '')
  );

comment on column public.business_payment_channels.payment_method is 'Active customer payment target: till | paybill | payhero.';
comment on column public.business_payment_channels.till_number is 'M-Pesa Till number customers pay to (when payment_method = till).';
comment on column public.business_payment_channels.paybill_number is 'M-Pesa PayBill number customers pay to (when payment_method = paybill).';
