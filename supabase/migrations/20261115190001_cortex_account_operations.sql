create sequence public.cortex_account_number_seq;
create table public.cortex_public_accounts (
  subject text primary key check (subject ~ '^(yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$'),
  number bigint not null unique default nextval('public.cortex_account_number_seq'),
  created_at timestamptz not null default now(),
  maintenance_until timestamptz
);
create table public.cortex_devices (
  device_hash text primary key check (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  version text not null,
  subject text references public.cortex_public_accounts
);
create table public.cortex_device_launches (
  id uuid primary key,
  device_hash text not null references public.cortex_devices,
  opened_at timestamptz not null default now(),
  subject text references public.cortex_public_accounts
);
create index cortex_device_launches_day on public.cortex_device_launches(opened_at,device_hash);
alter table public.cortex_public_accounts enable row level security;
alter table public.cortex_devices enable row level security;
alter table public.cortex_device_launches enable row level security;
revoke all on public.cortex_public_accounts,public.cortex_devices,public.cortex_device_launches from public,anon,authenticated;
revoke all on sequence public.cortex_account_number_seq from public,anon,authenticated;
grant select,insert on public.cortex_public_accounts to service_role;
grant select,insert,update on public.cortex_devices,public.cortex_device_launches to service_role;
grant usage on sequence public.cortex_account_number_seq to service_role;

create function public.cortex_public_account(p_subject text)
returns text language plpgsql set search_path = ''
as $$
declare account_number bigint;
begin
  select number into account_number from public.cortex_public_accounts where subject = p_subject;
  if not found then
    insert into public.cortex_public_accounts(subject) values(p_subject)
      on conflict(subject) do nothing returning number into account_number;
    if account_number is null then select number into account_number from public.cortex_public_accounts where subject = p_subject; end if;
  end if;
  return '@id' || lpad(account_number::text,greatest(6,length(account_number::text)),'0');
end
$$;

create function public.cortex_record_launch(p_device text,p_session uuid,p_subject text,p_version text,p_old_install text default null)
returns void language plpgsql set search_path = ''
as $$
begin
  if p_subject is not null then perform public.cortex_public_account(p_subject); end if;
  insert into public.cortex_devices(device_hash,version,subject,first_seen_at)
    values(p_device,p_version,p_subject,coalesce(
      (select first_seen_at from public.cortex_installs where install_hash = p_old_install),now()))
    on conflict(device_hash) do update set last_seen_at = now(),version = excluded.version,subject = excluded.subject,
      first_seen_at = least(cortex_devices.first_seen_at,excluded.first_seen_at);
  insert into public.cortex_device_launches(id,device_hash,subject)
    values(p_session,p_device,p_subject)
    on conflict(id) do update set subject = excluded.subject
    where cortex_device_launches.device_hash = excluded.device_hash and cortex_device_launches.subject is null;
end
$$;

create function cortex_private.resolve_account(p_public text)
returns text language sql stable set search_path = ''
as $$
  select subject from public.cortex_public_accounts
  where number = case when lower(trim(p_public)) ~ '^@id[0-9]{6,17}$' then substr(trim(p_public),4)::bigint end
$$;

create function cortex_private.admin_activity(p_action text,p_id text,p_days integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target text;
  today timestamptz := date_trunc('day',now(),'Europe/Moscow');
  grant_until timestamptz;
begin
  if caller is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' or not exists(
    select 1 from public.cortex_admin_roles where user_id = caller and role::text in ('owner','admin','support')
  ) or not exists(
    select 1 from auth.sessions where user_id = caller and id::text = auth.jwt()->>'session_id'
  ) then raise exception 'Administrative access required' using errcode = '42501'; end if;
  if p_action = 'overview' then
    return jsonb_build_object(
      'devices',(select count(*) from public.cortex_devices),
      'new_today',(select count(*) from public.cortex_devices where first_seen_at >= today),
      'opened_today',(select count(distinct device_hash) from public.cortex_device_launches where opened_at >= today),
      'launches_today',(select count(*) from public.cortex_device_launches where opened_at >= today),
      'accounts_today',(select count(distinct subject) from public.cortex_device_launches where opened_at >= today),
      'today',coalesce((select jsonb_agg(to_jsonb(a) order by a.opened_at desc) from (
        select '@id' || lpad(u.number::text,greatest(6,length(u.number::text)),'0') as public_id,
          max(l.opened_at) as opened_at, count(distinct l.device_hash) as devices
        from public.cortex_device_launches l join public.cortex_public_accounts u on u.subject = l.subject
        where l.opened_at >= today group by u.number order by max(l.opened_at) desc limit 100
      ) a),'[]'::jsonb));
  end if;
  if not exists(select 1 from public.cortex_admin_roles where user_id = caller and role::text in ('owner','admin')) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;
  target := cortex_private.resolve_account(p_id);
  if target is null then return null; end if;
  if p_action = 'maintenance' then
    if p_days is null or p_days not between 0 and 31 then raise exception 'Invalid access duration' using errcode = '22023'; end if;
    update public.cortex_public_accounts set maintenance_until = case when p_days > 0 then now() + make_interval(days => p_days) end
    where subject = target;
    insert into cortex_private.ai_changes(admin_id,subject,operation)
      values(caller,target,case when p_days = 0 then 'maintenance_revoke' else 'maintenance_grant' end);
  elsif p_action <> 'account' then raise exception 'Invalid activity operation' using errcode = '22023';
  end if;
  select maintenance_until into grant_until from public.cortex_public_accounts where subject = target;
  return jsonb_build_object('subject',target,'maintenance_until',grant_until);
end
$$;

create function public.cortex_admin_activity(p_action text default 'overview',p_id text default null,p_days integer default null)
returns jsonb language sql set search_path = ''
as $$ select cortex_private.admin_activity(p_action,p_id,p_days) $$;

revoke execute on function public.cortex_public_account(text),public.cortex_record_launch(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cortex_public_account(text),public.cortex_record_launch(text,uuid,text,text,text) to service_role;
revoke execute on function cortex_private.admin_activity(text,text,integer),public.cortex_admin_activity(text,text,integer) from public,anon;
grant execute on function cortex_private.admin_activity(text,text,integer),public.cortex_admin_activity(text,text,integer) to authenticated;

-- Admin sign-in can determine eligibility before offering MFA enrollment.
create function cortex_private.control_signin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.cortex_admin_roles where user_id = auth.uid()) $$;
create function public.cortex_control_signin()
returns boolean language sql stable set search_path = ''
as $$ select cortex_private.control_signin() $$;
revoke execute on function cortex_private.control_signin(),public.cortex_control_signin() from public,anon;
grant execute on function cortex_private.control_signin(),public.cortex_control_signin() to authenticated;
