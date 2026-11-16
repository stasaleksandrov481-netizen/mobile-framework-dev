-- Broader free beta access without weakening per-minute and provider-side budgets.
-- Keep Free below Start; account overrides and already-used credits are preserved.
update public.cortex_plans
   set daily_tokens = case code
     when 'guest' then 16000
     when 'free' then 35000
     else daily_tokens end
 where code in ('guest', 'free');

-- Legacy settings are still used by administrative tools that predate plans.
update public.cortex_ai_settings
   set guest_daily_tokens = greatest(guest_daily_tokens, 16000),
       daily_tokens = greatest(daily_tokens, 35000)
 where singleton;
