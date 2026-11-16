-- Keep only recent high-cardinality telemetry while preserving lifetime totals.
-- Bounded batches avoid large locks, and a transaction rolls back both deletes
-- and archived counters together if anything fails.
create table if not exists public.cortex_event_totals (
  metric text primary key check (metric in ('ai_requests','launches')),
  archived_count bigint not null default 0 check (archived_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.cortex_event_totals enable row level security;
revoke all on public.cortex_event_totals from public, anon, authenticated;
grant select on public.cortex_event_totals to service_role;

-- These append/delete and upsert-heavy tables should be vacuumed before dead
-- tuples occupy a large share of their pages under sustained traffic.
alter table public.cortex_ai_requests set
  (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);
alter table public.cortex_device_launches set
  (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);
alter table public.cortex_ai_attempts set
  (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);
alter table public.cortex_limits set
  (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);

create or replace function public.cortex_compact_events(p_batch integer default 8000)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  batch_size integer := least(8000,greatest(100,coalesce(p_batch,8000)));
  events_before timestamptz := clock_timestamp() - interval '3 days';
  removed_ai bigint := 0;
  archived_ai bigint := 0;
  removed_launches bigint := 0;
  removed_limits bigint := 0;
  removed_flows bigint := 0;
  removed_sessions bigint := 0;
  removed_attempts bigint := 0;
  removed_cron bigint := 0;
begin
  if not pg_try_advisory_xact_lock(140387,8) then
    return jsonb_build_object('skipped','already_running');
  end if;

  with doomed as (
    select id from public.cortex_ai_requests
    where requested_at < events_before
    order by requested_at limit batch_size for update skip locked
  ), removed as (
    delete from public.cortex_ai_requests r using doomed d
    where r.id=d.id returning r.kind
  )
  select count(*),count(*) filter(where kind <> 'check')
    into removed_ai,archived_ai from removed;

  if archived_ai > 0 then
    insert into public.cortex_event_totals(metric,archived_count)
      values('ai_requests',archived_ai)
    on conflict(metric) do update set archived_count =
      public.cortex_event_totals.archived_count + excluded.archived_count,
      updated_at=now();
  end if;

  with doomed as (
    select l.id from public.cortex_device_launches l
    where l.opened_at < events_before
      and not exists(
        select 1 from public.cortex_app_sessions s
        where s.id=l.id and s.last_seen_at >= clock_timestamp()-interval '7 days'
      )
    order by l.opened_at limit batch_size for update of l skip locked
  ), removed as (
    delete from public.cortex_device_launches l using doomed d
    where l.id=d.id returning l.id
  )
  select count(*) into removed_launches from removed;

  if removed_launches > 0 then
    insert into public.cortex_event_totals(metric,archived_count)
      values('launches',removed_launches)
    on conflict(metric) do update set archived_count =
      public.cortex_event_totals.archived_count + excluded.archived_count,
      updated_at=now();
  end if;

  with doomed as (
    select bucket,window_start from public.cortex_limits
    where window_start < extract(epoch from clock_timestamp())-172800
    order by window_start limit batch_size for update skip locked
  ), removed as (
    delete from public.cortex_limits l using doomed d
    where l.bucket=d.bucket and l.window_start=d.window_start returning l.bucket
  )
  select count(*) into removed_limits from removed;

  with doomed as (
    select state_hash from public.cortex_auth_flows
    where expires_at < clock_timestamp()-interval '1 day'
    order by expires_at limit batch_size for update skip locked
  ), removed as (
    delete from public.cortex_auth_flows f using doomed d
    where f.state_hash=d.state_hash returning f.state_hash
  )
  select count(*) into removed_flows from removed;

  with doomed as (
    select id from public.cortex_app_sessions
    where last_seen_at < clock_timestamp()-interval '7 days'
    order by last_seen_at limit batch_size for update skip locked
  ), removed as (
    delete from public.cortex_app_sessions s using doomed d
    where s.id=d.id returning s.id
  )
  select count(*) into removed_sessions from removed;

  -- Financial usage remains available for audits; only old free attempts expire.
  with doomed as (
    select id from public.cortex_ai_attempts
    where billing_payment is null and started_at < clock_timestamp()-interval '90 days'
    order by started_at limit batch_size for update skip locked
  ), removed as (
    delete from public.cortex_ai_attempts a using doomed d
    where a.id=d.id returning a.id
  )
  select count(*) into removed_attempts from removed;

  -- Supabase Cron logs each invocation, so its own log must also be bounded.
  with doomed as (
    select runid from cron.job_run_details
    where end_time < clock_timestamp()-interval '7 days'
    order by end_time limit batch_size
  ), removed as (
    delete from cron.job_run_details j using doomed d
    where j.runid=d.runid returning j.runid
  )
  select count(*) into removed_cron from removed;

  return jsonb_build_object(
    'ai_events',removed_ai,'launch_events',removed_launches,
    'expired_limits',removed_limits,'expired_flows',removed_flows,
    'stale_sessions',removed_sessions,'old_attempts',removed_attempts,
    'cron_logs',removed_cron
  );
end;
$$;
revoke execute on function public.cortex_compact_events(integer) from public, anon, authenticated, service_role;

-- Statistics use today's raw events plus archived lifetime counters.
create or replace function cortex_private.admin_metrics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  today timestamptz := date_trunc('day',now(),'Europe/Moscow');
  result jsonb;
begin
  if caller is null or coalesce(auth.jwt()->>'aal','') <> 'aal2'
    or not exists(select 1 from public.cortex_admin_roles where user_id=caller and role::text in ('owner','admin','support'))
    or not exists(select 1 from auth.sessions where user_id=caller and id::text=auth.jwt()->>'session_id'
      and (not_after is null or not_after>now())) then
    raise exception 'Administrative access required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'devices',(select count(*) from public.cortex_devices),
    'new_today',(select count(*) from public.cortex_devices where first_seen_at >= today),
    'opened_today',(select count(distinct device_hash) from public.cortex_device_launches where opened_at >= today),
    'opened_24h',(select count(distinct device_hash) from public.cortex_device_launches where opened_at >= now()-interval '24 hours'),
    'launches_total',(select count(*) from public.cortex_device_launches) +
      coalesce((select archived_count from public.cortex_event_totals where metric='launches'),0),
    'launches_today',(select count(*) from public.cortex_device_launches where opened_at >= today),
    'accounts_today',(select count(distinct subject) from public.cortex_device_launches where opened_at >= today and subject is not null),
    'online_devices',(select count(distinct l.device_hash) from public.cortex_device_launches l
      join public.cortex_app_sessions s on s.id=l.id where s.last_seen_at >= now()-interval '120 seconds'),
    'ai_requests_today',(select count(*) from public.cortex_ai_requests where requested_at >= today and kind <> 'check'),
    'ai_requests_total',(select count(*) from public.cortex_ai_requests where kind <> 'check') +
      coalesce((select archived_count from public.cortex_event_totals where metric='ai_requests'),0),
    'ai_attempts_today',(select count(*) from public.cortex_ai_attempts where started_at >= today),
    'ai_success_today',(select count(*) from public.cortex_ai_attempts where started_at >= today and input_tokens is not null),
    'ai_tokens_today',(select coalesce(sum(input_tokens::bigint+output_tokens),0) from public.cortex_ai_attempts where started_at >= today),
    'support_open',(select count(*) from public.cortex_support where status in ('open','in_progress')),
    'online',coalesce((select jsonb_agg(to_jsonb(a)) from (
      select distinct on(l.device_hash)
        coalesce(case when u.number is not null then '@id' || lpad(u.number::text,greatest(6,length(u.number::text)),'0') end,
                 case when g.number is not null then '@g' || lpad(g.number::text,greatest(6,length(g.number::text)),'0') end,'Гость') as public_id,
        s.last_seen_at as last_seen_at, l.subject is not null as signed_in, d.version as version
      from public.cortex_device_launches l
      join public.cortex_app_sessions s on s.id=l.id
      join public.cortex_devices d on d.device_hash=l.device_hash
      left join public.cortex_public_accounts u on u.subject=l.subject
      left join public.cortex_guest_public_ids g on g.install_hash=s.install_hash
      where s.last_seen_at >= now()-interval '120 seconds'
      order by l.device_hash,s.last_seen_at desc limit 100
    ) a),'[]'::jsonb)
  ) into result;
  return result;
end $$;

-- Supabase Cron invokes this as the database owner, not the untrusted API role.
create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  if exists(select 1 from cron.job where jobname='cortex-event-compaction') then
    perform cron.unschedule('cortex-event-compaction');
  end if;
  perform cron.schedule('cortex-event-compaction','*/5 * * * *',
    'select public.cortex_compact_events(8000)');
end;
$$;
