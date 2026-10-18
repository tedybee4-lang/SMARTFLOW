-- SMARTFLOW migration 0006: businesses.phone_e164 (normalised E.164 phone)
-- Depends on 0001 (businesses table).
--
-- Root cause fix: POST /api/onboarding inserts a normalised E.164 phone into
-- `businesses.phone_e164`, but migration 0001 only created `businesses.phone`.
-- Add the missing column additively; no existing data is touched and RLS is
-- unchanged. After applying, onboarding business creation succeeds.
--
-- NOTE: apply this to the NETPID production project (wmszgwrqwlhrfolkwwsn)
-- only after review/approval. It is additive and zero-risk to existing rows.

alter table public.businesses add column if not exists phone_e164 text;

create index if not exists idx_businesses_phone_e164 on public.businesses(phone_e164);
