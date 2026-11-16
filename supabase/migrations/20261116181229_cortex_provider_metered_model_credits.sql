-- Keep the provider's native token counts separate from the CORTEX balance.
-- A CORTEX token represents $0.20 per million of actual OpenRouter spend;
-- paid models therefore debit at different rates, including input vs output.
alter table public.cortex_ai_attempts
  add column if not exists native_input_tokens integer check (native_input_tokens >= 0),
  add column if not exists native_output_tokens integer check (native_output_tokens >= 0);

create or replace function public.cortex_paid_reserve(p_subject text,p_input integer,p_output integer,p_model text,p_advanced boolean)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  entitlement public.cortex_payments;
  today date := (now() at time zone 'UTC')::date;
  quota jsonb;
  attempt uuid;
  reserved_cost bigint;
  period_cost bigint;
  active_tokens bigint;
  paid_tokens bigint;
  advanced_used bigint;
  active_paid integer;
begin
  -- Both counts are *reserved CORTEX credits*, conservatively computed by
  -- the trusted Edge Function from the permitted maximum provider price.
  if p_input is null or p_input not between 1 and 2000000 or p_output is null or p_output not between 1 and 1000000
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
  -- 1 balance token = $0.00000020; microdollars = credits * 0.20.
  reserved_cost := ceil((p_input + p_output) * 0.20);
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

create or replace function public.cortex_paid_finish(p_attempt uuid,p_input integer,p_output integer,p_cost bigint)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  attempt public.cortex_ai_attempts;
  billed integer;
begin
  if p_cost is not null and p_cost not between 0 and 1000000
    or (p_input is null) <> (p_output is null)
    or p_input < 0 or p_output < 0 then
    raise exception 'Invalid provider usage' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(140387,1);
  select a.* into attempt from public.cortex_ai_attempts a
    where a.id = p_attempt and a.billing_payment is not null for update;
  if not found then return null; end if;
  if attempt.finished_at is not null then return public.cortex_ai_usage(attempt.subject); end if;
  -- A failed request without verified provider usage is not charged to the
  -- user. Keep its reserved liability to avoid overcommitting cloud funding.
  billed := case when p_cost is not null then ceil(p_cost * 5.0)::integer else 0 end;
  update public.cortex_ai_attempts a set native_input_tokens = p_input,
    native_output_tokens = p_output, measured_micros = coalesce(p_cost, attempt.reserved_micros)
    where a.id = p_attempt;
  return public.cortex_ai_finish(p_attempt,billed,0);
end
$$;

revoke all on function public.cortex_paid_reserve(text,integer,integer,text,boolean),
  public.cortex_paid_finish(uuid,integer,integer,bigint) from public, anon, authenticated;
grant execute on function public.cortex_paid_reserve(text,integer,integer,text,boolean),
  public.cortex_paid_finish(uuid,integer,integer,bigint) to service_role;
