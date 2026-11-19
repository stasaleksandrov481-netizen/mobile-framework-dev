-- Aggregated preregistration statistics for the protected CORTEX Control UI.
-- No email, user ID, session identifier or visitor fingerprint is returned.
create or replace function cortex_private.admin_site_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller uuid := auth.uid();
  today timestamptz := date_trunc('day', now(), 'Europe/Moscow');
  result jsonb;
begin
  if caller is null or coalesce(auth.jwt()->>'aal', '') <> 'aal2'
    or not exists (
      select 1 from public.cortex_admin_roles
      where user_id = caller and role::text in ('owner', 'admin')
    ) or not exists (
      select 1 from auth.sessions
      where user_id = caller and id::text = auth.jwt()->>'session_id'
        and (not_after is null or not_after > now())
    ) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'today', count(*) filter (where registered_at >= today),
    'last_24h', count(*) filter (where registered_at >= now() - interval '24 hours'),
    'last_7d', count(*) filter (where registered_at >= now() - interval '7 days'),
    'notifications', count(*) filter (where notify_opt_in),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', days.day::text,
        'count', coalesce(t.count, 0)
      ) order by days.day)
      from (
        select (now() at time zone 'Europe/Moscow')::date - n as day
        from generate_series(6, 0, -1) as n
      ) days
      left join (
        select (registered_at at time zone 'Europe/Moscow')::date as day, count(*) as count
        from public.cortex_preregistrations
        where registered_at >= now() - interval '8 days'
        group by 1
      ) t using (day)
    ), '[]'::jsonb)
  ) into result from public.cortex_preregistrations;

  return result;
end
$function$;

create or replace function public.cortex_admin_site_metrics()
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select cortex_private.admin_site_metrics()
$function$;

revoke execute on function cortex_private.admin_site_metrics(),
  public.cortex_admin_site_metrics() from public, anon;
grant execute on function cortex_private.admin_site_metrics(),
  public.cortex_admin_site_metrics() to authenticated;
