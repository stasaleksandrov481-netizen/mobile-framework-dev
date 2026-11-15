-- Billing tables are server-only. Existing AI history and quota overrides are retained.
create table public.cortex_plans (
  code text primary key check (code in ('guest','free','start','pro','ultra')),
  rank smallint unique not null check (rank between 0 and 4),
  price_kopecks integer not null check (price_kopecks between 0 and 10000000),
  daily_tokens integer not null check (daily_tokens between 1 and 1000000),
  context_chars integer not null check (context_chars between 3000 and 51000),
  advanced_tokens integer not null check (advanced_tokens between 0 and daily_tokens),
  check ((rank < 2 and price_kopecks = 0 and advanced_tokens = 0) or (rank >= 2 and price_kopecks > 0))
);
insert into public.cortex_plans values
  ('guest',0,0,5000,5000,0), ('free',1,0,15000,10000,0),
  ('start',2,19900,40000,20000,4000), ('pro',3,39900,100000,32000,20000),
  ('ultra',4,79900,200000,48000,60000);

create table public.cortex_billing_config (
  singleton boolean primary key default true check (singleton),
  checkout_enabled boolean not null default false,
  funded_micros bigint not null default 8000000 check (funded_micros between 0 and 1000000000000),
  committed_micros bigint not null default 0 check (committed_micros >= 0)
);
insert into public.cortex_billing_config default values;

create table public.cortex_payments (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (subject ~ '^(yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$'),
  plan text not null references public.cortex_plans,
  amount integer not null check (amount > 0),
  mode text not null check (mode in ('live','test','manual')),
  state text not null default 'creating' check (state in ('creating','pending','confirmed','canceled','refunded')),
  provider_id uuid unique,
  checkout_url text,
  liability bigint not null check (liability > 0),
  context_chars integer not null,
  daily_tokens integer not null,
  advanced_tokens integer not null,
  created_at timestamptz not null default clock_timestamp(),
  starts_at timestamptz,
  ends_at timestamptz,
  renewal boolean not null default false,
  check ((starts_at is null) = (ends_at is null))
);
create index cortex_payments_subject_created on public.cortex_payments(subject, created_at desc);
create unique index cortex_payments_one_checkout on public.cortex_payments(subject, mode)
  where state in ('creating','pending');
create index cortex_payments_active on public.cortex_payments(subject, ends_at desc)
  where state = 'confirmed' and mode <> 'test';

alter table public.cortex_ai_attempts
  add column billing_payment uuid references public.cortex_payments,
  add column billing_model text,
  add column billing_advanced boolean not null default false,
  add column reserved_micros bigint not null default 0,
  add column measured_micros bigint;
create index cortex_ai_attempts_payment_day on public.cortex_ai_attempts(billing_payment, day)
  where billing_payment is not null;

alter table public.cortex_plans enable row level security;
alter table public.cortex_billing_config enable row level security;
alter table public.cortex_payments enable row level security;
revoke all on public.cortex_plans, public.cortex_billing_config, public.cortex_payments from public, anon, authenticated;
grant select on public.cortex_plans to service_role;
grant select, update on public.cortex_billing_config to service_role;
grant select, insert, update on public.cortex_payments to service_role;

-- Existing per-account overrides continue to apply to the overall token quota.
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
    select a.day, sum(coalesce(a.input_tokens::bigint + a.output_tokens, 0)) as used
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
  )
  select jsonb_build_object(
    'id',p_subject,'unit','tokens','used',coalesce(t.used,0),'limit',s.maximum,'unlimited',s.unlimited,
    'remaining',case when not s.unlimited then greatest(0,s.maximum - coalesce(t.used,0)) end,
    'allowed',s.unlimited or coalesce(t.used,0) < s.maximum,
    'reset_at',(c.day + 1)::timestamp at time zone 'UTC','time_zone','Europe/Moscow',
    'plan',s.plan,'context_chars',s.context_chars,'advanced_tokens',s.advanced_tokens,
    'ends_at',s.ends_at,'auto_renew',coalesce(s.renewal,false),
    'history',(select jsonb_agg(jsonb_build_object('day',days.day::date,'used',coalesce(history.used,0)) order by days.day)
      from generate_series((c.day - 6)::timestamp,c.day::timestamp,interval '1 day') as days(day)
      left join totals history on days.day::date = history.day))
  from clock c cross join settings s left join totals t on t.day = c.day
$$;

create function public.cortex_subscription(p_subject text)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('quota',public.cortex_ai_usage(p_subject),
    'plans',(select jsonb_agg(to_jsonb(p) order by rank) from public.cortex_plans p),
    'checkout',(select checkout_enabled from public.cortex_billing_config),
    'payments',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from (
      select id,plan,amount,state,created_at,ends_at from public.cortex_payments
      where subject = p_subject and mode = 'live' and state <> 'creating'
      order by created_at desc limit 30
    ) h),'[]'::jsonb))
$$;

create function public.cortex_paid_reserve(p_subject text,p_input integer,p_output integer,p_model text,p_advanced boolean)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  entitlement public.cortex_payments;
  today date := (now() at time zone 'UTC')::date;
  quota jsonb;
  attempt uuid;
  rate numeric := case when p_advanced then 0.60 else 0.20 end;
  reserved_cost bigint;
  period_cost bigint;
  active_tokens bigint;
  paid_tokens bigint;
  advanced_used bigint;
  active_paid integer;
begin
  if p_input is null or p_input not between 1 and 200000 or p_output is null or p_output not between 1 and 4000
    or p_model is null or p_model !~ '^[a-z0-9._-]+/[a-z0-9._-]+$' or p_advanced is null then
    raise exception 'Invalid paid AI reservation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(140387,1);
  quota := public.cortex_ai_usage(p_subject);
  select p.* into entitlement from public.cortex_payments p
  where p.subject = p_subject and p.mode in ('live','manual') and p.state = 'confirmed'
    and p.starts_at <= now() and p.ends_at > now()
  order by p.starts_at desc,p.created_at desc limit 1;
  if not found then return jsonb_build_object('quota',quota,'error','paid_unavailable'); end if;
  select count(*) into active_paid from public.cortex_ai_attempts a where a.billing_payment is not null
    and a.started_at >= now() - interval '2 minutes' and a.finished_at is null;
  if active_paid >= (case entitlement.plan when 'ultra' then 20 when 'pro' then 16 else 12 end) then
    return jsonb_build_object('quota',quota,'error','paid_unavailable');
  end if;
  select coalesce(sum(a.reserved),0) into active_tokens
  from public.cortex_ai_attempts a where a.subject = p_subject and a.day = today and a.finished_at is null
    and a.started_at > now() - interval '2 minutes';
  select coalesce(sum(coalesce(a.input_tokens::bigint + a.output_tokens, a.reserved)),0),
    coalesce(sum(coalesce(a.input_tokens::bigint + a.output_tokens,a.reserved)) filter(where a.billing_advanced),0)
  into paid_tokens,advanced_used from public.cortex_ai_attempts a
  where a.billing_payment = entitlement.id and a.day = today;
  p_output := least(p_output, entitlement.daily_tokens - paid_tokens - p_input,
    coalesce((quota->>'remaining')::bigint,entitlement.daily_tokens) - active_tokens - p_input);
  if p_advanced then p_output := least(p_output,entitlement.advanced_tokens - advanced_used - p_input); end if;
  if p_output < 100 then
    return jsonb_build_object('quota',quota,'error',case when p_advanced then 'advanced_limit' else 'paid_unavailable' end);
  end if;
  reserved_cost := ceil((p_input + p_output) * rate);
  select coalesce(sum(coalesce(a.measured_micros,a.reserved_micros)),0) into period_cost
    from public.cortex_ai_attempts a where a.billing_payment = entitlement.id;
  if period_cost + reserved_cost > entitlement.liability then
    return jsonb_build_object('quota',quota,'error','paid_unavailable');
  end if;
  insert into public.cortex_ai_attempts
    (subject,day,started_at,reserved,billing_payment,billing_model,billing_advanced,reserved_micros)
  values(p_subject,today,now(),p_input+p_output,entitlement.id,p_model,p_advanced,reserved_cost)
  returning id into attempt;
  return jsonb_build_object('quota',quota,'attempt',attempt,'max_output',p_output);
end
$$;

create function public.cortex_paid_finish(p_attempt uuid,p_input integer,p_output integer,p_cost bigint)
returns jsonb language plpgsql set search_path = ''
as $$
declare result jsonb;
begin
  if p_cost < 0 then raise exception 'Invalid provider cost' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(140387,1);
  if not exists(select 1 from public.cortex_ai_attempts where id = p_attempt and billing_payment is not null) then
    return null;
  end if;
  result := public.cortex_ai_finish(p_attempt,p_input,p_output);
  update public.cortex_ai_attempts set measured_micros = coalesce(measured_micros,p_cost) where id = p_attempt;
  return result;
end
$$;

-- 32 quota days cover calendar months that start or end mid-day. Rates are the enforced
-- inference ceilings in micro-USD per token. The margin covers rounding and estimation.
create function public.cortex_billing_order(p_subject text,p_plan text,p_mode text,p_days integer default 0)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  plan public.cortex_plans;
  config public.cortex_billing_config;
  order_row public.cortex_payments;
  required bigint;
  next_start timestamptz;
begin
  if p_mode not in ('live','test','manual') or p_days not between 0 and 31
    or (p_mode = 'manual') <> (p_days > 0) then
    raise exception 'Invalid subscription order' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(140387,2);
  select * into config from public.cortex_billing_config where singleton;
  select * into plan from public.cortex_plans where code = p_plan and rank >= 2;
  if plan.code is null then return jsonb_build_object('error','invalid_plan'); end if;
  if p_mode = 'live' and not config.checkout_enabled then
    return jsonb_build_object('error','payments_disabled');
  end if;
  if p_mode <> 'manual' then
    select * into order_row from public.cortex_payments
    where subject = p_subject and mode = p_mode and state in ('creating','pending');
    if found then
      return to_jsonb(order_row) || jsonb_build_object('existing',true);
    end if;
  end if;
  required := ceil((case when p_days > 0 then p_days + 1 else 32 end)
    * (plan.daily_tokens * 0.20 + plan.advanced_tokens * 0.40) * 1.20);
  if p_mode <> 'test' then
    if config.committed_micros + required > config.funded_micros then
      return jsonb_build_object('error','funding_unavailable');
    end if;
    update public.cortex_billing_config set committed_micros = committed_micros + required where singleton;
  end if;
  if p_mode = 'manual' then
    select greatest(now(),max(p.ends_at)) into next_start from public.cortex_payments p
      where p.subject = p_subject and p.state = 'confirmed' and p.mode <> 'test' and p.plan = p_plan;
  end if;
  insert into public.cortex_payments(subject,plan,amount,mode,state,liability,context_chars,daily_tokens,advanced_tokens,starts_at,ends_at)
  values(p_subject,p_plan,plan.price_kopecks,p_mode,case when p_mode = 'manual' then 'confirmed' else 'creating' end,
    required,plan.context_chars,plan.daily_tokens,plan.advanced_tokens,next_start,next_start + make_interval(days => p_days))
  returning * into order_row;
  return to_jsonb(order_row) || jsonb_build_object('existing',false);
end
$$;

-- The gateway verifies Platega's transaction independently before this RPC is called.
-- A refund permanently invalidates its period. Replayed confirmations cannot grant time again.
create function public.cortex_billing_payment(p_id uuid,p_mode text,p_provider uuid,p_state text,p_amount integer,
  p_url text default null)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  entry public.cortex_payments;
  period_start timestamptz;
begin
  if p_mode not in ('live','test') or p_state not in ('pending','confirmed','canceled','refunded')
    or p_provider is null then raise exception 'Invalid payment event' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(140387,2);
  select * into entry from public.cortex_payments where id = p_id and mode = p_mode for update;
  if not found or entry.amount <> p_amount or (entry.provider_id is not null and entry.provider_id <> p_provider) then
    return null;
  end if;
  if entry.state = 'refunded' or entry.state = 'canceled'
    or entry.state = 'confirmed' and p_state <> 'refunded' then return to_jsonb(entry); end if;
  if p_state = 'confirmed' then
    select greatest(now(),max(ends_at)) into period_start from public.cortex_payments
      where subject = entry.subject and mode = entry.mode and state = 'confirmed';
  elsif p_state in ('canceled','refunded') and entry.state in ('creating','pending') and p_mode = 'live' then
    update public.cortex_billing_config set committed_micros = committed_micros - entry.liability where singleton;
  end if;
  update public.cortex_payments set provider_id = p_provider, state = p_state,
    checkout_url = coalesce(p_url,checkout_url),
    starts_at = coalesce(period_start,starts_at), ends_at = coalesce(period_start + interval '1 month',ends_at)
  where id = p_id returning * into entry;
  return to_jsonb(entry);
end
$$;

create function cortex_private.admin_billing(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  operation text;
  response jsonb;
begin
  if caller is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' or not exists (
    select 1 from public.cortex_admin_roles where user_id = caller and role::text in ('owner','admin')
  ) or not exists (
    select 1 from auth.sessions where user_id = caller and id::text = auth.jwt()->>'session_id'
  ) then raise exception 'Administrative access required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(140387,2);
  if p_action = 'plan' then
    update public.cortex_plans set price_kopecks = (p_data->>'price')::integer,
      daily_tokens = (p_data->>'tokens')::integer, advanced_tokens = (p_data->>'advanced')::integer,
      context_chars = (p_data->>'context')::integer where code = p_data->>'plan';
    if not found then raise exception 'Unknown plan' using errcode = '22023'; end if;
    if exists(select 1 from public.cortex_plans p join public.cortex_plans q on p.rank + 1 = q.rank
      where p.daily_tokens >= q.daily_tokens) then
      raise exception 'Daily quotas must increase with plan tier' using errcode = '22023';
    end if;
  elsif p_action = 'funding' then
    update public.cortex_billing_config set funded_micros = (p_data->>'micros')::bigint,
      checkout_enabled = (p_data->>'checkout')::boolean
    where singleton and (p_data->>'micros')::bigint >= committed_micros;
    if not found then raise exception 'Funding cannot be lower than commitments' using errcode = '22023'; end if;
  elsif p_action = 'grant' then
    if not exists(select 1 from public.cortex_sessions where account->>'id' = p_data->>'subject')
      and not exists(select 1 from auth.users where id::text = p_data->>'subject') then
      raise exception 'Account ID not found' using errcode = '22023';
    end if;
    response := public.cortex_billing_order(p_data->>'subject',p_data->>'plan','manual',(p_data->>'days')::integer);
    if response ? 'error' then raise exception 'Cannot grant subscription: %',response->>'error' using errcode = '22023'; end if;
  elsif p_action = 'revoke' then
    update public.cortex_payments set state = 'canceled'
      where id::text = p_data->>'id' and mode = 'manual' and state = 'confirmed';
    if not found then raise exception 'Manual subscription not found' using errcode = '22023'; end if;
  elsif p_action = 'authorize_refund' then
    if not exists (select 1 from public.cortex_payments where id::text = p_data->>'id' and mode = 'live'
      and state in ('confirmed','refunded')) then
      raise exception 'Refund is unavailable' using errcode = '22023';
    end if;
  elsif p_action <> 'overview' then raise exception 'Invalid billing operation' using errcode = '22023';
  end if;
  if p_action <> 'overview' then
    operation := 'billing_' || p_action;
    insert into cortex_private.ai_changes(admin_id,subject,operation)
      values(caller,coalesce(p_data->>'subject',p_data->>'id',p_data->>'plan','openrouter'),operation);
  end if;
  return jsonb_build_object(
    'plans',(select jsonb_agg(to_jsonb(p) order by rank) from public.cortex_plans p),
    'funding',(select to_jsonb(c) - 'singleton' from public.cortex_billing_config c),
    'paid_accounts',(select count(distinct subject) from public.cortex_payments
      where mode <> 'test' and state = 'confirmed' and starts_at <= now() and ends_at > now()),
    'collected',(select coalesce(sum(amount),0) from public.cortex_payments where mode = 'live' and state = 'confirmed'),
    'refunded',(select coalesce(sum(amount),0) from public.cortex_payments where mode = 'live' and state = 'refunded'),
    'models',coalesce((select jsonb_agg(to_jsonb(m) order by model) from (
      select coalesce(billing_model,'free') as model,count(*) as calls,
        coalesce(sum(measured_micros),0) as measured_micros,
        coalesce(sum(reserved_micros) filter(where measured_micros is null),0) as unsettled_micros
      from public.cortex_ai_attempts where day >= (now() at time zone 'UTC')::date - 29
      group by billing_model) m),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from (
      select p.id,p.subject,p.plan,p.mode,p.state,p.amount,p.starts_at,p.ends_at,p.created_at,
        case when a.number is not null then '@id' || lpad(a.number::text,greatest(6,length(a.number::text)),'0') end as public_id
      from public.cortex_payments p left join public.cortex_public_accounts a on a.subject = p.subject
      where p.mode <> 'test' order by p.created_at desc limit 100) r),'[]'::jsonb)
  );
end
$$;

create function public.cortex_admin_billing(p_action text default 'overview',p_data jsonb default '{}'::jsonb)
returns jsonb language sql set search_path = ''
as $$ select cortex_private.admin_billing(p_action,p_data) $$;

revoke execute on function public.cortex_subscription(text), public.cortex_paid_reserve(text,integer,integer,text,boolean),
  public.cortex_paid_finish(uuid,integer,integer,bigint), public.cortex_billing_order(text,text,text,integer),
  public.cortex_billing_payment(uuid,text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.cortex_subscription(text), public.cortex_paid_reserve(text,integer,integer,text,boolean),
  public.cortex_paid_finish(uuid,integer,integer,bigint), public.cortex_billing_order(text,text,text,integer),
  public.cortex_billing_payment(uuid,text,uuid,text,integer,text) to service_role;
revoke execute on function cortex_private.admin_billing(text,jsonb), public.cortex_admin_billing(text,jsonb) from public,anon;
grant execute on function cortex_private.admin_billing(text,jsonb), public.cortex_admin_billing(text,jsonb) to authenticated;
