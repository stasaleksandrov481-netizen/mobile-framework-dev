-- Give one 5,000-token pool to people who verified their email before open beta.
-- The reservation remains inaccessible until 2026-11-20 00:00 Moscow time.
-- Bonus tokens do not refresh when ordinary daily AI tokens reset.
alter table public.cortex_preregistrations
  add column claimed_subject text unique,
  add column bonus_spent integer not null default 0
    check (bonus_spent >= 0 and bonus_spent <= bonus_tokens);

alter table public.cortex_ai_attempts
  add column bonus_applied integer not null default 0
    check (bonus_applied >= 0 and bonus_applied <= coalesce(input_tokens, 0) + coalesce(output_tokens, 0));

create unique index cortex_preregistrations_email_unique
  on public.cortex_preregistrations (lower(email));

create function public.cortex_ai_claim_early_bonus(p_subject text, p_email text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  awarded uuid;
begin
  if now() < timestamptz '2026-11-20 00:00:00+03'
      or coalesce(p_subject, '') !~ '^(yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$'
      or p_email is null or char_length(p_email) not between 3 and 254 then
    return false;
  end if;
  -- This RPC is only executable by the server service role, which first verifies
  -- the identity by Supabase Auth or Yandex OAuth. The client cannot mint tokens.
  update public.cortex_preregistrations p
    set claimed_subject = p_subject, bonus_granted_at = coalesce(p.bonus_granted_at, now())
    where lower(p.email) = lower(p_email) and p.bonus_tokens = 5000
      and p.registered_at < timestamptz '2026-11-20 00:00:00+03'
      and (p.claimed_subject is null or p.claimed_subject = p_subject)
      and p.bonus_spent < p.bonus_tokens
    returning p.user_id into awarded;
  return awarded is not null;
end
$$;

create or replace function public.cortex_ai_usage(p_subject text)
returns jsonb
language sql
stable
set search_path = ''
as $$
    with clock as (
        select (now() at time zone 'UTC')::date as day
    ), totals as (
        select a.day,
          sum(coalesce(a.input_tokens, 0)::bigint + coalesce(a.output_tokens, 0)) as used,
          sum(a.bonus_applied::bigint) as bonus_today
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
    ), bonus as (
        select coalesce(sum(p.bonus_tokens - p.bonus_spent), 0)::bigint as remaining,
          coalesce(sum(p.bonus_tokens), 0)::bigint as granted
        from public.cortex_preregistrations p
        where p.claimed_subject = p_subject and p.bonus_granted_at is not null
    )
    select jsonb_build_object(
        'id', p_subject, 'unit', 'tokens', 'used', coalesce(t.used, 0),
        'limit', s.maximum + b.remaining + coalesce(t.bonus_today, 0),
        'unlimited', s.unlimited,
        'bonus_granted', b.granted, 'bonus_remaining', b.remaining,
        'remaining', case when not s.unlimited then
          greatest(0, s.maximum - (coalesce(t.used, 0) - coalesce(t.bonus_today, 0))) + b.remaining end,
        'allowed', s.unlimited or
          (greatest(0, s.maximum - (coalesce(t.used, 0) - coalesce(t.bonus_today, 0))) + b.remaining) > 0,
        'reset_at', (c.day + 1)::timestamp at time zone 'UTC', 'time_zone', 'Europe/Moscow',
        'history', (select jsonb_agg(jsonb_build_object('day', days.day::date, 'used', coalesce(history.used, 0)) order by days.day)
            from generate_series((c.day - 6)::timestamp, c.day::timestamp, interval '1 day') as days(day)
            left join totals history on days.day::date = history.day)
    )
    from clock c cross join settings s cross join bonus b left join totals t on t.day = c.day
$$;

create or replace function public.cortex_ai_finish(p_attempt uuid, p_input integer, p_output integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    target text;
    finished_day date;
    base_limit integer;
    base_used bigint;
    needed integer;
    available integer;
    granted_user uuid;
    awarded integer;
    is_unlimited boolean;
begin
    if (p_input is null) <> (p_output is null) or p_input < 0 or p_output < 0 then
        raise exception 'Invalid AI usage' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(140387, 1);
    update public.cortex_ai_attempts a set
        finished_at = clock_timestamp(),
        input_tokens = p_input,
        output_tokens = p_output
      where a.id = p_attempt and a.finished_at is null
      returning a.subject, a.day into target, finished_day;
    if not found then
      select a.subject into target from public.cortex_ai_attempts a where a.id = p_attempt;
      if target is null then return null; end if;
      return public.cortex_ai_usage(target);
    end if;

    select coalesce(l.daily_tokens, s.daily_tokens), coalesce(l.unlimited, false)
      into base_limit, is_unlimited
      from public.cortex_ai_settings s
      left join public.cortex_ai_limits l on l.subject = target
      where s.singleton;

    if not is_unlimited then
      select coalesce(sum(coalesce(a.input_tokens, 0)::bigint + coalesce(a.output_tokens, 0) - a.bonus_applied), 0)
        into base_used
        from public.cortex_ai_attempts a
        left join public.cortex_ai_limits l on l.subject = target
        where a.subject = target and a.day = finished_day
          and (l.cleared_at is null or a.started_at >= l.cleared_at);
      needed := greatest(0, least(5000, base_used - base_limit))::integer;
      if needed > 0 then
        select p.user_id, p.bonus_tokens - p.bonus_spent
          into granted_user, available
          from public.cortex_preregistrations p
          where p.claimed_subject = target and p.bonus_granted_at is not null
          for update;
        if found then
          awarded := least(needed, available);
          if awarded > 0 then
            update public.cortex_preregistrations p set bonus_spent = p.bonus_spent + awarded
              where p.user_id = granted_user;
            update public.cortex_ai_attempts a set bonus_applied = awarded where a.id = p_attempt;
          end if;
        end if;
      end if;
    end if;
    return public.cortex_ai_usage(target);
end
$$;

-- Redis REST credentials are kept in encrypted Vault, never in client bundles.
create function public.cortex_redis_config()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select case when count(*) = 2 then jsonb_build_object(
    'url', max(d.decrypted_secret) filter (where d.name = 'cortex_upstash_url'),
    'token', max(d.decrypted_secret) filter (where d.name = 'cortex_upstash_token')
  ) else null end
  from vault.decrypted_secrets d
  where d.name in ('cortex_upstash_url', 'cortex_upstash_token')
$$;

revoke execute on function public.cortex_ai_claim_early_bonus(text, text),
  public.cortex_redis_config() from public, anon, authenticated;
grant execute on function public.cortex_ai_claim_early_bonus(text, text),
  public.cortex_redis_config() to service_role;
