create schema if not exists cortex_private;

create table public.cortex_beta_quotas (
    id text primary key check (id ~ '^(guest_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$'),
    period date not null,
    used integer not null default 0 check (used >= 0),
    daily_limit integer check (daily_limit between 0 and 10000),
    unlimited boolean not null default false,
    linked_account text
);

alter table public.cortex_beta_quotas enable row level security;
revoke all on public.cortex_beta_quotas from public, anon, authenticated;
grant select, insert, update on public.cortex_beta_quotas to service_role;

create table cortex_private.beta_quota_changes (
    at timestamptz not null default now(),
    admin_id uuid not null,
    target_id text not null,
    operation text not null,
    daily_limit integer
);

alter table cortex_private.beta_quota_changes enable row level security;

create function cortex_private.beta_quota_period()
returns date
language sql
stable
set search_path = ''
as $$
    select ((now() at time zone 'Europe/Moscow') - interval '3 hours')::date
$$;

create function cortex_private.beta_quota_view(entry public.cortex_beta_quotas)
returns jsonb
language sql
stable
set search_path = ''
as $$
    select jsonb_build_object(
        'id', entry.id,
        'used', case when entry.period = cortex_private.beta_quota_period() then entry.used else 0 end,
        'limit', coalesce(entry.daily_limit, 80),
        'unlimited', entry.unlimited,
        'remaining', case when entry.unlimited then null else greatest(0, coalesce(entry.daily_limit, 80) -
            case when entry.period = cortex_private.beta_quota_period() then entry.used else 0 end) end,
        'reset_at', ((cortex_private.beta_quota_period() + 1) + time '03:00') at time zone 'Europe/Moscow',
        'time_zone', 'Europe/Moscow'
    )
$$;

create function public.cortex_beta_quota(
    p_id text, p_guest_id text, p_guest_owner text, p_account_owner text, p_consume boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    quota_day date := cortex_private.beta_quota_period();
    entry public.cortex_beta_quotas;
    guest public.cortex_beta_quotas;
    permitted boolean;
begin
    if not p_consume and p_guest_id is null then
        select * into entry from public.cortex_beta_quotas as q where q.id = p_id;
        if not found then
            entry.id := p_id;
            entry.period := quota_day;
            entry.used := 0;
            entry.unlimited := false;
        end if;
        permitted := entry.unlimited or
            (case when entry.period = quota_day then entry.used else 0 end) < coalesce(entry.daily_limit, 80);
        return cortex_private.beta_quota_view(entry) || jsonb_build_object('allowed', permitted);
    end if;

    insert into public.cortex_beta_quotas (id, period)
        select distinct ids.id, quota_day from unnest(array[p_id, p_guest_id]) as ids(id)
        where ids.id is not null order by ids.id
        on conflict (id) do nothing;

    perform 1 from public.cortex_beta_quotas as q
        where q.id in (p_id, p_guest_id) order by q.id for update;
    select * into strict entry from public.cortex_beta_quotas as q where q.id = p_id;
    if entry.period <> quota_day then
        entry.period := quota_day;
        entry.used := 0;
    end if;

    if p_guest_id is not null and p_guest_id <> p_id then
        select * into strict guest from public.cortex_beta_quotas as q where q.id = p_guest_id;
        if guest.linked_account is null then
            if guest.period = quota_day then
                entry.used := entry.used + guest.used;
            end if;
            update public.cortex_beta_quotas as q set linked_account = p_id where q.id = p_guest_id;
            if p_guest_owner is not null and p_account_owner is not null then
                update public.cortex_support set device_hash = p_account_owner where device_hash = p_guest_owner;
            end if;
        end if;
    end if;

    permitted := entry.unlimited or entry.used < coalesce(entry.daily_limit, 80);
    if p_consume and permitted then
        entry.used := entry.used + 1;
    end if;
    update public.cortex_beta_quotas as q set period = entry.period, used = entry.used
        where q.id = entry.id and (q.period <> entry.period or q.used <> entry.used);
    return cortex_private.beta_quota_view(entry) || jsonb_build_object('allowed', permitted);
end;
$$;

create function cortex_private.admin_beta_quota(p_id text, p_operation text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    quota_day date := cortex_private.beta_quota_period();
    entry public.cortex_beta_quotas;
begin
    if caller is null or coalesce(auth.jwt()->>'aal', '') <> 'aal2' or not exists (
        select 1 from public.cortex_admin_roles where user_id = caller and role::text in ('owner', 'admin')
    ) then
        raise exception 'Administrative access required' using errcode = '42501';
    end if;

    select * into entry from public.cortex_beta_quotas as q where q.id = p_id;
    if not found then
        if p_id ~ '^guest_[A-Za-z0-9_-]{43}$' then
            if not exists (select 1 from public.cortex_installs where install_hash = substr(p_id, 7)) then return null; end if;
        elsif p_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
            if not exists (select 1 from auth.users where id = p_id::uuid) then return null; end if;
        else
            return null;
        end if;
        entry.id := p_id;
        entry.period := quota_day;
        entry.used := 0;
        entry.unlimited := false;
    end if;

    if p_operation = 'read' then
        return cortex_private.beta_quota_view(entry);
    end if;
    insert into public.cortex_beta_quotas (id, period) values (p_id, quota_day) on conflict (id) do nothing;

    if p_operation not in ('limit', 'reset', 'unlimited', 'revoke') or p_operation is null
        or (p_operation = 'limit' and (p_limit is null or p_limit not between 0 and 10000)) then
        raise exception 'Invalid quota operation' using errcode = '22023';
    end if;
    update public.cortex_beta_quotas as q set
        period = quota_day,
        used = case when p_operation = 'reset' or q.period <> quota_day then 0 else q.used end,
        daily_limit = case when p_operation = 'limit' then p_limit when p_operation = 'revoke' then null else q.daily_limit end,
        unlimited = case when p_operation = 'unlimited' then true when p_operation in ('limit', 'revoke') then false else q.unlimited end
        where q.id = p_id returning * into entry;
    if not found then return null; end if;
    insert into cortex_private.beta_quota_changes (admin_id, target_id, operation, daily_limit)
        values (caller, p_id, p_operation, entry.daily_limit);
    return cortex_private.beta_quota_view(entry);
end;
$$;

create function public.cortex_admin_beta_quota(p_id text, p_operation text default 'read', p_limit integer default null)
returns jsonb
language sql
set search_path = ''
as $$
    select cortex_private.admin_beta_quota(p_id, p_operation, p_limit)
$$;

grant usage on schema cortex_private to service_role, authenticated;
revoke execute on function cortex_private.beta_quota_period() from public, anon, authenticated;
revoke execute on function cortex_private.beta_quota_view(public.cortex_beta_quotas) from public, anon, authenticated;
grant execute on function cortex_private.beta_quota_period() to service_role;
grant execute on function cortex_private.beta_quota_view(public.cortex_beta_quotas) to service_role;
revoke execute on function public.cortex_beta_quota(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.cortex_beta_quota(text, text, text, text, boolean) to service_role;
revoke execute on function cortex_private.admin_beta_quota(text, text, integer) from public, anon;
grant execute on function cortex_private.admin_beta_quota(text, text, integer) to authenticated;
revoke execute on function public.cortex_admin_beta_quota(text, text, integer) from public, anon;
grant execute on function public.cortex_admin_beta_quota(text, text, integer) to authenticated;
