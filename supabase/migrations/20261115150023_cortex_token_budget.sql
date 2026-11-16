-- Credits are measured from provider usage. Attempt rows also serialize the shared
-- OpenRouter budget across Edge workers and keep in-flight reservations separate.
create schema if not exists cortex_private;

create table public.cortex_ai_settings (
    singleton boolean primary key default true check (singleton),
    daily_tokens integer not null default 15000 check (daily_tokens between 0 and 1000000),
    requests_day integer check (requests_day between 1 and 1000),
    requests_minute integer check (requests_minute between 1 and 20),
    model text check (char_length(model) <= 120 and model ~ '^[a-z0-9._-]+/[a-z0-9._-]+:free$')
);
insert into public.cortex_ai_settings default values;

create table public.cortex_ai_limits (
    subject text primary key,
    daily_tokens integer check (daily_tokens between 0 and 1000000),
    unlimited boolean not null default false,
    cleared_at timestamptz
);

create table public.cortex_ai_attempts (
    id uuid primary key default gen_random_uuid(),
    subject text not null,
    day date not null,
    started_at timestamptz not null,
    reserved integer not null check (reserved > 0),
    finished_at timestamptz,
    input_tokens integer check (input_tokens >= 0),
    output_tokens integer check (output_tokens >= 0)
);
create index cortex_ai_attempts_subject_day on public.cortex_ai_attempts (subject, day);
create index cortex_ai_attempts_started_at on public.cortex_ai_attempts (started_at);

alter table public.cortex_ai_settings enable row level security;
alter table public.cortex_ai_limits enable row level security;
alter table public.cortex_ai_attempts enable row level security;
revoke all on public.cortex_ai_settings, public.cortex_ai_limits, public.cortex_ai_attempts from public, anon, authenticated;
grant select on public.cortex_ai_settings, public.cortex_ai_limits to service_role;
grant select, insert, update on public.cortex_ai_attempts to service_role;

create table cortex_private.ai_guest_owners (
    install text primary key,
    subject text not null
);
create table cortex_private.ai_changes (
    at timestamptz not null default now(),
    admin_id uuid not null,
    subject text not null,
    operation text not null,
    daily_tokens integer
);
alter table cortex_private.ai_guest_owners enable row level security;
alter table cortex_private.ai_changes enable row level security;
revoke all on cortex_private.ai_guest_owners, cortex_private.ai_changes from public, anon, authenticated;
grant usage on schema cortex_private to service_role, authenticated;
grant insert on cortex_private.ai_guest_owners to service_role;

-- Import the old settings where the request-based beta migration was deployed.
-- Request counts have no unit-preserving conversion to model tokens.
do $migration$
begin
    if to_regclass('public.cortex_beta_quotas') is not null then
        execute 'insert into public.cortex_ai_limits (subject, daily_tokens, unlimited)
            select id, case when daily_limit = 0 then 0 end, unlimited
            from public.cortex_beta_quotas where daily_limit = 0 or unlimited';
        execute 'insert into cortex_private.ai_guest_owners (install, subject)
            select substr(id, 7), linked_account from public.cortex_beta_quotas
            where left(id, 6) = ''guest_'' and linked_account is not null';
    end if;
end
$migration$;

create index if not exists cortex_sessions_account_id on public.cortex_sessions ((account->>'id'));

create function public.cortex_ai_usage(p_subject text)
returns jsonb
language sql
stable
set search_path = ''
as $$
    with clock as (
        select (now() at time zone 'UTC')::date as day
    ), totals as (
        select a.day, sum(coalesce(a.input_tokens, 0)::bigint + coalesce(a.output_tokens, 0)) as used
        from public.cortex_ai_attempts a
        cross join clock c
        left join public.cortex_ai_limits l on l.subject = p_subject
        where a.subject = p_subject and a.day between c.day - 6 and c.day
            and (a.day < c.day or l.cleared_at is null or a.started_at >= l.cleared_at)
        group by a.day
    ), settings as (
        select coalesce(l.daily_tokens, s.daily_tokens) as maximum, coalesce(l.unlimited, false) as unlimited
        from public.cortex_ai_settings s
        left join public.cortex_ai_limits l on l.subject = p_subject
        where s.singleton
    )
    select jsonb_build_object(
        'id', p_subject, 'unit', 'tokens', 'used', coalesce(t.used, 0), 'limit', s.maximum, 'unlimited', s.unlimited,
        'remaining', case when not s.unlimited then greatest(0, s.maximum - coalesce(t.used, 0)) end,
        'allowed', s.unlimited or coalesce(t.used, 0) < s.maximum,
        'reset_at', (c.day + 1)::timestamp at time zone 'UTC', 'time_zone', 'Europe/Moscow',
        'history', (select jsonb_agg(jsonb_build_object('day', days.day::date, 'used', coalesce(history.used, 0)) order by days.day)
            from generate_series((c.day - 6)::timestamp, c.day::timestamp, interval '1 day') as days(day)
            left join totals history on days.day::date = history.day)
    )
    from clock c cross join settings s left join totals t on t.day = c.day
$$;

create function public.cortex_ai_reserve(
    p_subject text, p_input integer, p_output integer, p_day_cap integer, p_minute_cap integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    started timestamptz;
    today date;
    midnight timestamptz;
    settings public.cortex_ai_settings;
    daily integer;
    per_minute integer;
    recent integer;
    oldest timestamptz;
    active integer;
    available integer;
    quota jsonb;
    attempt uuid;
begin
    if p_subject is null or p_subject !~ '^(guest_[A-Za-z0-9_-]{43}|yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$'
        or coalesce(p_input, 0) not between 1 and 150000 or coalesce(p_output, 0) not between 1 and 4000 then
        raise exception 'Invalid AI reservation' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(140387, 1);
    started := now();
    today := (started at time zone 'UTC')::date;
    midnight := today::timestamp at time zone 'UTC';
    select * into strict settings from public.cortex_ai_settings s where s.singleton;
    quota := public.cortex_ai_usage(p_subject);
    daily := least(coalesce(settings.requests_day, p_day_cap), greatest(1, least(1000, coalesce(p_day_cap, 50))));
    per_minute := least(coalesce(settings.requests_minute, p_minute_cap), greatest(1, least(20, coalesce(p_minute_cap, 20))));

    if (select count(*) from public.cortex_ai_attempts a where a.started_at >= midnight) >= daily then
        return jsonb_build_object('quota', quota, 'error', 'provider_quota_daily', 'retry_after',
            greatest(1, ceil(extract(epoch from midnight + interval '1 day' - started))));
    end if;
    select count(*), min(a.started_at) into recent, oldest from public.cortex_ai_attempts a
        where a.started_at > started - interval '1 minute';
    if recent >= per_minute then
        return jsonb_build_object('quota', quota, 'error', 'provider_quota', 'retry_after',
            greatest(1, ceil(extract(epoch from oldest + interval '1 minute' - started))));
    end if;

    if not (quota->>'unlimited')::boolean then
        select coalesce(sum(a.reserved), 0)::integer into active from public.cortex_ai_attempts a
            where a.subject = p_subject and a.day = today and a.finished_at is null
              and a.started_at > started - interval '2 minutes';
        available := (quota->>'remaining')::integer - p_input;
        if available < least(p_output, 100) then
            return jsonb_build_object('quota', quota, 'error', 'daily_limit');
        end if;
        if available - active < least(p_output, 100) then
            return jsonb_build_object('quota', quota, 'error', 'busy', 'retry_after', 5);
        end if;
        p_output := least(p_output, available - active);
    end if;
    insert into public.cortex_ai_attempts (subject, day, started_at, reserved)
        values (p_subject, today, started, p_input + p_output) returning id into attempt;
    return jsonb_build_object('attempt', attempt, 'max_output', p_output, 'quota', quota);
end
$$;

create function public.cortex_ai_finish(p_attempt uuid, p_input integer, p_output integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    target text;
begin
    if (p_input is null) <> (p_output is null) or p_input < 0 or p_output < 0 then
        raise exception 'Invalid AI usage' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(140387, 1);
    update public.cortex_ai_attempts a set
        finished_at = coalesce(a.finished_at, clock_timestamp()),
        input_tokens = coalesce(a.input_tokens, p_input),
        output_tokens = coalesce(a.output_tokens, p_output)
        where a.id = p_attempt returning a.subject into target;
    if not found then return null; end if;
    return public.cortex_ai_usage(target);
end
$$;

-- First successful account sign-in claims pre-existing guest support threads once.
-- Token history stays attached to the subject that made each provider call.
create function public.cortex_claim_guest(p_install text, p_owner text, p_subject text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    if coalesce(p_install, '') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(p_owner, '') !~ '^account_[A-Za-z0-9_-]{43}$'
        or coalesce(p_subject, '') !~ '^(yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$' then
        return false;
    end if;
    insert into cortex_private.ai_guest_owners (install, subject) values (p_install, p_subject)
        on conflict do nothing;
    if not found then return false; end if;
    update public.cortex_support set device_hash = p_owner where device_hash = 'install_' || p_install;
    return true;
end
$$;
grant select, update on public.cortex_support to service_role;

create function cortex_private.admin_ai(
    p_subject text, p_operation text, p_limit integer, p_day integer, p_minute integer, p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
begin
    if caller is null or coalesce(auth.jwt()->>'aal', '') <> 'aal2' or not exists (
        select 1 from public.cortex_admin_roles where user_id = caller and role::text in ('owner', 'admin')
    ) then
        raise exception 'Administrative access required' using errcode = '42501';
    end if;

    if p_operation in ('config', 'configure') then
        if p_operation = 'configure' then
            perform pg_advisory_xact_lock(140387, 1);
            if p_limit is null then raise exception 'Enter a daily token limit' using errcode = '22023'; end if;
            update public.cortex_ai_settings set daily_tokens = p_limit, requests_day = p_day,
                requests_minute = p_minute, model = nullif(p_model, '') where singleton;
            insert into cortex_private.ai_changes (admin_id, subject, operation, daily_tokens)
                values (caller, 'openrouter', 'token_config', p_limit);
        end if;
        return (select to_jsonb(s) - 'singleton' from public.cortex_ai_settings s where s.singleton);
    end if;

    if p_subject is null or p_subject !~ '^(guest_[A-Za-z0-9_-]{43}|yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$' then
        return null;
    end if;
    if not exists (select 1 from public.cortex_ai_limits where subject = p_subject)
        and not exists (select 1 from public.cortex_ai_attempts where subject = p_subject)
        and not exists (select 1 from public.cortex_installs where 'guest_' || install_hash = p_subject)
        and not exists (select 1 from auth.users where id::text = p_subject) then return null;
    end if;

    if p_operation = 'read' then return public.cortex_ai_usage(p_subject); end if;
    if p_operation is null or p_operation not in ('limit', 'reset', 'unlimited', 'revoke')
        or (p_operation = 'limit' and p_limit is null) then
        raise exception 'Invalid quota operation' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(140387, 1);
    insert into public.cortex_ai_limits (subject) values (p_subject) on conflict (subject) do nothing;
    update public.cortex_ai_limits l set
        daily_tokens = case when p_operation = 'limit' then p_limit when p_operation = 'revoke' then null else l.daily_tokens end,
        unlimited = case when p_operation = 'unlimited' then true when p_operation in ('limit', 'revoke') then false else l.unlimited end,
        cleared_at = case when p_operation = 'reset' then clock_timestamp() else l.cleared_at end
        where l.subject = p_subject;
    insert into cortex_private.ai_changes (admin_id, subject, operation, daily_tokens)
        values (caller, p_subject, 'token_' || p_operation, p_limit);
    return public.cortex_ai_usage(p_subject);
end
$$;

create function public.cortex_admin_ai(
    p_subject text default null, p_operation text default 'read', p_limit integer default null,
    p_day integer default null, p_minute integer default null, p_model text default null
)
returns jsonb
language sql
set search_path = ''
as $$
    select cortex_private.admin_ai(p_subject, p_operation, p_limit, p_day, p_minute, p_model)
$$;

revoke execute on function public.cortex_ai_usage(text), public.cortex_ai_reserve(text, integer, integer, integer, integer),
    public.cortex_ai_finish(uuid, integer, integer), public.cortex_claim_guest(text, text, text) from public, anon, authenticated;
grant execute on function public.cortex_ai_usage(text), public.cortex_ai_reserve(text, integer, integer, integer, integer),
    public.cortex_ai_finish(uuid, integer, integer), public.cortex_claim_guest(text, text, text) to service_role;
revoke execute on function cortex_private.admin_ai(text, text, integer, integer, integer, text),
    public.cortex_admin_ai(text, text, integer, integer, integer, text) from public, anon;
grant execute on function cortex_private.admin_ai(text, text, integer, integer, integer, text),
    public.cortex_admin_ai(text, text, integer, integer, integer, text) to authenticated;
