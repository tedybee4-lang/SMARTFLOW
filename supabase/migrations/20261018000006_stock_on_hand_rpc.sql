-- SMARTFLOW migration 0008 (20261018000006): stock on-hand RPC for POS checkout.
-- Additive, idempotent. Depends on 0002 (stock_movements).
-- SECURITY INVOKER: callers must pass RLS-visible rows (service role bypasses RLS;
-- an authenticated member's own reads are already tenant-scoped by policy).

create or replace function public.stock_on_hand(p_business_id uuid, p_product_ids uuid[])
returns table (product_id uuid, on_hand numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select sm.product_id,
         coalesce(sum(sm.quantity_delta), 0)::numeric(12,2) as on_hand
  from public.stock_movements sm
  where sm.business_id = p_business_id
    and sm.product_id = any(p_product_ids)
  group by sm.product_id;
$$;

grant execute on function public.stock_on_hand(uuid, uuid[]) to authenticated, service_role;