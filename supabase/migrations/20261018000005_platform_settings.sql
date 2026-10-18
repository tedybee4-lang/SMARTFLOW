-- SMARTFLOW migration: platform settings + platform (no-business) payment attempts.
-- Platform test consoles record payment_attempts with purpose='platform' and NO
-- business_id, so business_id must be nullable. Non-secret operational settings
-- (channel IDs, sender ID, base URL) live in platform_settings and are editable
-- by platform admins via /api/admin/platform-settings. SECRETS (API keys,
-- passwords, tokens) stay server-only env vars and are NEVER stored here.

alter table public.payment_attempts
  alter column business_id drop not null;

create table if not exists public.platform_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

drop policy if exists "platform manage settings" on public.platform_settings;
create policy "platform manage settings" on public.platform_settings
  for all using (public.is_platform_admin());

-- Seed known keys with empty values (env remains the fallback at runtime).
insert into public.platform_settings (key, value) values
  ('payhero_platform_channel_id', ''),
  ('payhero_sms_channel_id', ''),
  ('topspeed_sender_id', 'SMARTFLOW'),
  ('topspeed_base_url', 'https://sms.ispledger.com/api/v3')
on conflict (key) do nothing;

comment on table public.platform_settings is 'Non-secret platform config editable by platform admins. Secrets stay in env vars.';
