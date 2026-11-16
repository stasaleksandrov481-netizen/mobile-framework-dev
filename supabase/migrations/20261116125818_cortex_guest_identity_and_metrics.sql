-- Keep account, installation and guest identities separate. Public IDs are labels,
-- never authentication tokens or permission grants.
create sequence if not exists public.cortex_guest_number_seq;
create table if not exists public.cortex_guest_public_ids (
  install_hash text primary key check (install_hash ~ '^[A-Za-z0-9_-]{43}$'),
  number bigint not null unique default nextval('public.cortex_guest_number_seq'),
  created_at timestamptz not null default now()
);
alter table public.cortex_guest_public_ids enable row level security;
revoke all on public.cortex_guest_public_ids from public, anon, authenticated;
revoke all on sequence public.cortex_guest_number_seq from public, anon, authenticated;
grant select, insert on public.cortex_guest_public_ids to service_role;
grant usage on sequence public.cortex_guest_number_seq to service_role;
create index if not exists cortex_app_sessions_install_seen on public.cortex_app_sessions(install_hash,last_seen_at desc);
create index if not exists cortex_device_launches_device on public.cortex_device_launches(device_hash);

create or replace function public.cortex_public_guest(p_install text)
returns text language plpgsql set search_path = '' as $$
declare n bigint;
begin
  if p_install is null or p_install !~ '^[A-Za-z0-9_-]{43}$' then return null; end if;
  insert into public.cortex_guest_public_ids(install_hash) values(p_install)
    on conflict(install_hash) do nothing returning number into n;
  if n is null then
    select number into n from public.cortex_guest_public_ids where install_hash = p_install;
  end if;
  return '@g' || lpad(n::text,greatest(6,length(n::text)),'0');
end $$;
revoke execute on function public.cortex_public_guest(text) from public, anon, authenticated;
grant execute on function public.cortex_public_guest(text) to service_role;

-- A running app can switch from guest to account or sign out without creating
-- another launch. Update that session's current owner, including to NULL.
create or replace function public.cortex_record_launch(
  p_device text,p_session uuid,p_subject text,p_version text,p_old_install text default null
)
returns void language plpgsql set search_path = '' as $$
begin
  if p_device !~ '^[A-Za-z0-9_-]{43}$' or p_version is null or length(p_version) > 24 then
    raise exception 'Invalid device presence' using errcode='22023';
  end if;
  if p_subject is not null then perform public.cortex_public_account(p_subject); end if;
  insert into public.cortex_devices(device_hash,version,subject,first_seen_at)
    values(p_device,p_version,p_subject,coalesce(
      (select first_seen_at from public.cortex_installs where install_hash=p_old_install),now()))
    on conflict(device_hash) do update set last_seen_at=now(),version=excluded.version,subject=excluded.subject,
      first_seen_at=least(cortex_devices.first_seen_at,excluded.first_seen_at);
  insert into public.cortex_device_launches(id,device_hash,subject)
    values(p_session,p_device,p_subject)
    on conflict(id) do update set subject=excluded.subject
    where cortex_device_launches.device_hash=excluded.device_hash;
end $$;
revoke execute on function public.cortex_record_launch(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cortex_record_launch(text,uuid,text,text,text) to service_role;

-- One row per accepted user request, not one row per upstream model fallback.
create table if not exists public.cortex_ai_requests (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (subject ~ '^(guest_[A-Za-z0-9_-]{43}|yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$'),
  kind text not null check (kind in ('chat','visual','check')),
  requested_at timestamptz not null default clock_timestamp()
);
create index if not exists cortex_ai_requests_requested_at on public.cortex_ai_requests(requested_at);
create index if not exists cortex_ai_requests_subject_at on public.cortex_ai_requests(subject,requested_at desc);
alter table public.cortex_ai_requests enable row level security;
revoke all on public.cortex_ai_requests from public, anon, authenticated;
grant select, insert on public.cortex_ai_requests to service_role;

create or replace function public.cortex_track_ai_request(p_subject text,p_kind text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_subject !~ '^(guest_[A-Za-z0-9_-]{43}|yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$'
    or p_kind not in ('chat','visual','check') then
    raise exception 'Invalid AI event' using errcode = '22023';
  end if;
  insert into public.cortex_ai_requests(subject,kind) values (p_subject,p_kind);
end $$;
revoke execute on function public.cortex_track_ai_request(text,text) from public, anon, authenticated;
grant execute on function public.cortex_track_ai_request(text,text) to service_role;

-- Admin-only lookup for short guest IDs. Account IDs continue through the
-- existing role-checked activity resolver. Neither lookup is a bearer token.
create or replace function cortex_private.admin_resolve_guest(p_public text)
returns text language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); resolved text;
begin
  if caller is null or coalesce(auth.jwt()->>'aal','') <> 'aal2'
    or not exists(select 1 from public.cortex_admin_roles where user_id=caller and role::text in ('owner','admin'))
    or not exists(select 1 from auth.sessions where user_id=caller and id::text=auth.jwt()->>'session_id'
      and (not_after is null or not_after>now())) then
    raise exception 'Administrative access required' using errcode='42501';
  end if;
  if p_public is null or lower(trim(p_public)) !~ '^@g[0-9]{6,17}$' then return null; end if;
  select 'guest_' || install_hash into resolved from public.cortex_guest_public_ids
    where number = substr(lower(trim(p_public)),3)::bigint;
  return resolved;
end $$;
create or replace function public.cortex_admin_resolve_guest(p_public text)
returns text language sql set search_path = '' as $$
  select cortex_private.admin_resolve_guest(p_public)
$$;
revoke execute on function cortex_private.admin_resolve_guest(text), public.cortex_admin_resolve_guest(text) from public,anon;
grant execute on function cortex_private.admin_resolve_guest(text), public.cortex_admin_resolve_guest(text) to authenticated;

-- All metrics below come from current authoritative tables. A phone is counted
-- once by its stable server-hashed Android device identity, not by launches.
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
    'launches_total',(select count(*) from public.cortex_device_launches),
    'launches_today',(select count(*) from public.cortex_device_launches where opened_at >= today),
    'accounts_today',(select count(distinct subject) from public.cortex_device_launches where opened_at >= today and subject is not null),
    'online_devices',(select count(distinct l.device_hash) from public.cortex_device_launches l
      join public.cortex_app_sessions s on s.id=l.id where s.last_seen_at >= now()-interval '120 seconds'),
    'ai_requests_today',(select count(*) from public.cortex_ai_requests where requested_at >= today and kind <> 'check'),
    'ai_requests_total',(select count(*) from public.cortex_ai_requests where kind <> 'check'),
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
create or replace function public.cortex_admin_metrics()
returns jsonb language sql set search_path = '' as $$
  select cortex_private.admin_metrics()
$$;
revoke execute on function cortex_private.admin_metrics(),public.cortex_admin_metrics() from public,anon;
grant execute on function cortex_private.admin_metrics(),public.cortex_admin_metrics() to authenticated;
