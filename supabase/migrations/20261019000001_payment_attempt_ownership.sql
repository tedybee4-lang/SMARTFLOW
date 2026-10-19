-- SMARTFLOW migration: trusted payment_attempt ownership metadata.
--
-- The STK route now resolves the PayHero channel SERVER-side (business channel
-- for customer→business order payments, central platform channel for
-- subscription/SMS payments) and verifies that the referenced entity (order,
-- subscription invoice, SMS purchase) belongs to the same business BEFORE an
-- attempt row is written. The trusted values are persisted so the callback can
-- re-verify ownership before it credits anything.
--
-- Client-supplied values are never stored as fact: `channel_id` holds the
-- server-resolved channel and `channel_source` records which resolver produced
-- it. The existing `order_id` / `subscription_invoice_id` / `sms_purchase_id`
-- foreign keys are the ownership reference the callback re-checks.

alter table public.payment_attempts
  add column if not exists channel_source text;

alter table public.payment_attempts
  drop constraint if exists payment_attempts_channel_source_check;
alter table public.payment_attempts
  add constraint payment_attempts_channel_source_check
  check (channel_source is null or channel_source in ('business','platform'));

comment on column public.payment_attempts.channel_source is 'Which resolver produced channel_id: business (tenant channel) or platform (central channel).';
