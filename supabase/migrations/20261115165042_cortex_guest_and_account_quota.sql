alter table public.cortex_ai_settings
    add column guest_daily_tokens integer not null default 5000 check (guest_daily_tokens between 0 and 1000000),
    alter column daily_tokens set default 20000;

update public.cortex_ai_settings set daily_tokens = 20000 where singleton;

create or replace function public.cortex_ai_usage(p_subject text)
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
        select coalesce(l.daily_tokens, case when left(p_subject, 6) = 'guest_'
            then s.guest_daily_tokens else s.daily_tokens end) as maximum,
            coalesce(l.unlimited, false) as unlimited
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
