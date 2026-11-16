-- Back-pressure is enforced by atomic UPSERTs, but cleanup must not run on
-- every request. Even read-only health checks hit this function.
create or replace function public.cortex_reserve(p_limits jsonb)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  rule record;
  window_at bigint;
begin
  if jsonb_typeof(p_limits) is distinct from 'array'
     or jsonb_array_length(p_limits) not between 1 and 12 then
    raise exception 'Invalid rate-limit request' using errcode = '22023';
  end if;

  -- About one request in 100 performs bounded maintenance. An advisory try-lock
  -- prevents multiple workers from cleaning at once; expired windows are never
  -- needed to enforce current limits. Keep the expiry index in place.
  if random() < 0.01 and pg_try_advisory_xact_lock(140387, 3) then
    delete from public.cortex_limits
    where ctid in (
      select ctid from public.cortex_limits
      where window_start < extract(epoch from clock_timestamp()) - 172800
      order by window_start
      limit 512
    );
  end if;

  for rule in
    select entry.bucket, entry.seconds, entry.maximum
    from jsonb_to_recordset(p_limits) as entry(bucket text, seconds integer, maximum integer)
    order by entry.bucket
  loop
    if rule.bucket is null or length(rule.bucket) not between 1 and 160
       or rule.seconds is null or rule.seconds not between 1 and 86400
       or rule.maximum is null or rule.maximum not between 1 and 100000 then
      raise exception 'Invalid rate-limit rule' using errcode = '22023';
    end if;
    window_at := floor(extract(epoch from now()) / rule.seconds)::bigint * rule.seconds;
    insert into public.cortex_limits as quota (bucket, window_start, hits)
      values (rule.bucket, window_at, 1)
      on conflict (bucket, window_start) do update set hits = quota.hits + 1
      where quota.hits < rule.maximum;
    if not found then
      raise sqlstate 'PT429' using message = 'rate_limit';
    end if;
  end loop;
end;
$function$;

-- The limiter must only be callable by the server-side gateway.
revoke execute on function public.cortex_reserve(jsonb) from public, anon, authenticated;
grant execute on function public.cortex_reserve(jsonb) to service_role;

-- Missing foreign-key indexes reported by the live Supabase performance advisor.
create index if not exists cortex_device_launches_subject_idx
  on public.cortex_device_launches(subject) where subject is not null;
create index if not exists cortex_devices_subject_idx
  on public.cortex_devices(subject) where subject is not null;
create index if not exists cortex_payments_plan_idx
  on public.cortex_payments(plan);
create index if not exists cortex_support_replies_author_idx
  on public.cortex_support_replies(author_id) where author_id is not null;
