-- Advanced credits are a subset of daily credits, not a second spending purse.
-- cortex_paid_finish debits actual OpenRouter micro-USD * 5, so 1 paid credit
-- represents $0.20 per 1,000,000 credits. The original billing reservation
-- counted advanced credits a second time at $0.40/M, preventing reasonable
-- Haiku 5.5 plans from being sold even when the real provider budget sufficed.
-- Keep the 32-day/20% safety margin, the existing funded budget and all
-- payment state guards; never manufacture provider funds.

create or replace function public.cortex_billing_order(
  p_subject text, p_plan text, p_mode text, p_days integer default 0
)
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
  -- Max real provider spend is already bounded by the entire daily balance.
  -- Advanced usage is counted inside this balance by cortex_paid_reserve.
  required := ceil((case when p_days > 0 then p_days + 1 else 32 end)
    * plan.daily_tokens * 0.20 * 1.20);
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

revoke all on function public.cortex_billing_order(text,text,text,integer) from public, anon, authenticated;
grant execute on function public.cortex_billing_order(text,text,text,integer) to service_role;

-- Haiku 5.5: a 19k-input/1k-output request is about 12k CORTEX credits
-- at current OpenRouter prices. These advanced limits give Start ~15,
-- Pro ~33 and Ultra ~75 such daily requests before request-size reservation.
update public.cortex_plans
set daily_tokens = case code
      when 'start' then 500000
      when 'pro' then 650000
      when 'ultra' then 950000
    end,
    advanced_tokens = case code
      when 'start' then 180000
      when 'pro' then 400000
      when 'ultra' then 900000
    end
where code in ('start', 'pro', 'ultra');
