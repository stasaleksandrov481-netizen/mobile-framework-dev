-- Production migration applied 2026-11-18 through Supabase migration API.
-- Only change free-tier plan entitlements; paid subscriptions remain intact.
-- Guard against silently overwriting an administrator's newer quota choices.
DO $$
DECLARE changed_count integer;
BEGIN
  UPDATE public.cortex_plans
     SET daily_tokens = CASE code
       WHEN 'guest' THEN 3000
       WHEN 'free' THEN 15000
       ELSE daily_tokens
     END
   WHERE (code = 'guest' AND price_kopecks = 0 AND daily_tokens = 15000)
      OR (code = 'free' AND price_kopecks = 0 AND daily_tokens = 30000);
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 2 THEN
    RAISE EXCEPTION 'Unexpected CORTEX quota baseline: expected exactly 2 rows, updated %', changed_count;
  END IF;
END $$;
