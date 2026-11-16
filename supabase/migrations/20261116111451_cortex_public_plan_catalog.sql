-- The public price list uses the same catalogue as Android checkout.
grant select (code, rank, price_kopecks, daily_tokens, advanced_tokens)
  on public.cortex_plans to anon, authenticated;

create policy "Read public CORTEX plans"
  on public.cortex_plans for select to anon, authenticated
  using (true);
