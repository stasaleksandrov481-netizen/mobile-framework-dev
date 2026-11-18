-- No recipients are selected without explicit notify_opt_in=true.
-- A short-lived claim prevents overlapping cron invocations from mailing the same user.

alter table public.cortex_preregistrations
  add column if not exists notification_claim_token uuid,
  add column if not exists notification_claimed_at timestamptz;

create or replace function public.cortex_claim_beta_notifications(p_limit integer default 40)
returns table(user_id uuid, email text, claim_token uuid)
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select p.user_id
    from public.cortex_preregistrations p
    join auth.users u on u.id = p.user_id
    where u.email_confirmed_at is not null
      and lower(u.email) = lower(p.email)
      and p.notify_opt_in = true
      and p.notified_at is null
      and (
        p.notification_claimed_at is null
        or p.notification_claimed_at < now() - interval '20 minutes'
      )
    order by p.registered_at, p.user_id
    for update of p skip locked
    limit least(greatest(p_limit, 1), 40)
  )
  update public.cortex_preregistrations p
  set notification_claimed_at = now(),
      notification_claim_token = gen_random_uuid()
  from candidates c
  where p.user_id = c.user_id
  returning p.user_id, p.email, p.notification_claim_token;
$$;

revoke all on function public.cortex_claim_beta_notifications(integer)
  from public, anon, authenticated;
grant execute on function public.cortex_claim_beta_notifications(integer)
  to service_role;

comment on function public.cortex_claim_beta_notifications(integer) is
  'Service-role only. Atomically claims opted-in beta recipients for a bounded SMTP batch.';
