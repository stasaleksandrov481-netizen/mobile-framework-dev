-- Authenticated users may read only their own Android AI quota. Never accept
-- a subject from the browser: the underlying usage RPC is service-role only.
create or replace function public.cortex_web_account_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  quota jsonb;
begin
  if account_id is null or not exists (
    select 1 from auth.users u
    where u.id = account_id and u.email_confirmed_at is not null
  ) then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  quota := public.cortex_ai_usage(account_id::text);
  if quota is null then
    return null;
  end if;

  return jsonb_build_object(
    'daily_limit', quota->'daily_limit',
    'used', quota->'used',
    'remaining', quota->'remaining',
    'unlimited', quota->'unlimited',
    'plan', quota->'plan',
    'reset_at', quota->'reset_at',
    'bonus_remaining', quota->'bonus_remaining'
  );
end;
$$;

revoke all on function public.cortex_web_account_usage() from public, anon, authenticated;
grant execute on function public.cortex_web_account_usage() to authenticated;

comment on function public.cortex_web_account_usage() is
  'Read-only, authenticated self-service AI quota. Subject is derived from auth.uid; never client-provided.';
