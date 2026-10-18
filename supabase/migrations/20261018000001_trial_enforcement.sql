-- SMARTFLOW migration 0007: automatic 7-day free trials
-- Every new business automatically gets a 7-day trial subscription; existing
-- businesses are backfilled from their created_at timestamp.

alter table public.subscriptions
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz;

-- Security definer so the trigger works regardless of the caller's RLS on
-- subscriptions (businesses are inserted through the user-scoped client).
create or replace function public.ensure_trial_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (business_id, status, trial_started_at, trial_ends_at)
  values (new.id, 'trial', now(), now() + interval '7 days')
  on conflict (business_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_businesses_trial on public.businesses;
create trigger trg_businesses_trial
  after insert on public.businesses
  for each row execute function public.ensure_trial_subscription();

-- Backfill: any business without a subscription row gets a trial anchored at
-- its creation time (may already be expired for old businesses — that is the
-- correct enforcement point; platform admin can grant an active plan).
insert into public.subscriptions (business_id, status, trial_started_at, trial_ends_at)
select b.id, 'trial', b.created_at, b.created_at + interval '7 days'
from public.businesses b
where not exists (
  select 1 from public.subscriptions s where s.business_id = b.id
);

comment on column public.subscriptions.trial_started_at is 'Start of the 7-day free trial (set by ensure_trial_subscription trigger).';
comment on column public.subscriptions.trial_ends_at is 'End of the 7-day free trial; selling is blocked after this until a paid plan is active.';
