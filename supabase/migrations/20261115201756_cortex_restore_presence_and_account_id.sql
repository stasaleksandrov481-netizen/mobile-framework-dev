-- Preserve subscription quotas and preregistration balances in the same usage record.
create or replace function public.cortex_ai_usage(p_subject text)
returns jsonb language sql stable set search_path = ''
as $$
  with clock as (select (now() at time zone 'UTC')::date as day),
  entitlement as (
    select p.* from public.cortex_payments p
    where p.subject = p_subject and p.mode in ('live','manual') and p.state = 'confirmed'
      and p.starts_at <= now() and p.ends_at > now()
    order by p.starts_at desc, p.created_at desc limit 1
  ), totals as (
    select a.day, sum(coalesce(a.input_tokens,0)::bigint + coalesce(a.output_tokens,0)) as used,
      sum(a.bonus_applied::bigint) as bonus_today
    from public.cortex_ai_attempts a cross join clock c
    left join public.cortex_ai_limits l on l.subject = p_subject
    where a.subject = p_subject and a.day between c.day - 6 and c.day
      and (a.day < c.day or l.cleared_at is null or a.started_at >= l.cleared_at)
    group by a.day
  ), settings as (
    select coalesce(l.daily_tokens,e.daily_tokens,p.daily_tokens) as maximum,
      coalesce(l.unlimited,false) as unlimited, coalesce(e.plan,p.code) as plan,
      coalesce(e.context_chars,p.context_chars) as context_chars,
      coalesce(e.advanced_tokens,p.advanced_tokens) as advanced_tokens, e.ends_at,
      e.id as entitlement_id, e.renewal
    from public.cortex_plans p left join entitlement e on true
    left join public.cortex_ai_limits l on l.subject = p_subject
    where p.code = case when left(p_subject,6) = 'guest_' then 'guest' else 'free' end
  ), bonus as (
    select coalesce(sum(p.bonus_tokens - p.bonus_spent),0)::bigint as remaining,
      coalesce(sum(p.bonus_tokens),0)::bigint as granted
    from public.cortex_preregistrations p
    where p.claimed_subject = p_subject and p.bonus_granted_at is not null
  )
  select jsonb_build_object(
    'id',p_subject,'unit','tokens','used',coalesce(t.used,0),'daily_limit',s.maximum,
    'limit',s.maximum + b.remaining + coalesce(t.bonus_today,0),'unlimited',s.unlimited,
    'bonus_granted',b.granted,'bonus_remaining',b.remaining,
    'remaining',case when not s.unlimited then
      greatest(0,s.maximum - (coalesce(t.used,0) - coalesce(t.bonus_today,0))) + b.remaining end,
    'allowed',s.unlimited or greatest(0,s.maximum - (coalesce(t.used,0) - coalesce(t.bonus_today,0))) + b.remaining > 0,
    'reset_at',(c.day + 1)::timestamp at time zone 'UTC','time_zone','Europe/Moscow',
    'plan',s.plan,'context_chars',s.context_chars,'advanced_tokens',s.advanced_tokens,
    'ends_at',s.ends_at,'auto_renew',coalesce(s.renewal,false),
    'history',(select jsonb_agg(jsonb_build_object('day',days.day::date,'used',coalesce(history.used,0)) order by days.day)
      from generate_series((c.day - 6)::timestamp,c.day::timestamp,interval '1 day') as days(day)
      left join totals history on days.day::date = history.day))
  from clock c cross join settings s cross join bonus b left join totals t on t.day = c.day
$$;


CREATE OR REPLACE FUNCTION public.cortex_ai_finish(p_attempt uuid, p_input integer, p_output integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

    select (quota.value->>'daily_limit')::integer, (quota.value->>'unlimited')::boolean
      into base_limit, is_unlimited
      from (select public.cortex_ai_usage(target) as value) quota;

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
$function$;

-- Administrators can see the app ID of their own email account independently of phone launches.
create function cortex_private.admin_public_id()
returns text language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' or not exists (
    select 1 from public.cortex_admin_roles where user_id = caller
  ) or not exists (
    select 1 from auth.sessions where user_id = caller and id::text = auth.jwt()->>'session_id'
      and (not_after is null or not_after > now())
  ) then raise exception 'Administrative access required' using errcode = '42501'; end if;
  return public.cortex_public_account(caller::text);
end
$$;

create function public.cortex_admin_public_id()
returns text language sql set search_path = ''
as $$ select cortex_private.admin_public_id() $$;

revoke execute on function cortex_private.admin_public_id(), public.cortex_admin_public_id() from public, anon;
grant execute on function cortex_private.admin_public_id(), public.cortex_admin_public_id() to authenticated;
