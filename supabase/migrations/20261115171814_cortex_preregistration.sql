-- Applied to the CORTEX production project under migration version 20261115171814.
-- Pre-registration is bound to the same Supabase Auth identity used by the
-- Cortex Android backend. Public clients never choose or grant token balances.
create table public.cortex_preregistrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  notify_opt_in boolean not null default false,
  registered_at timestamptz not null default now(),
  bonus_tokens integer not null default (
    case when now() < timestamptz '2026-11-20 00:00:00+03' then 5000 else 0 end
  ) check (bonus_tokens in (0, 5000)),
  bonus_granted_at timestamptz,
  notified_at timestamptz
);

create index cortex_preregistrations_notify
  on public.cortex_preregistrations (registered_at)
  where notify_opt_in and notified_at is null;

alter table public.cortex_preregistrations enable row level security;
revoke all on public.cortex_preregistrations from public, anon, authenticated;
grant select on public.cortex_preregistrations to authenticated;
grant insert (user_id, email, notify_opt_in) on public.cortex_preregistrations to authenticated;
grant update (user_id, email, notify_opt_in) on public.cortex_preregistrations to authenticated;
grant select, insert, update on public.cortex_preregistrations to service_role;

create policy cortex_preregistration_read
  on public.cortex_preregistrations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy cortex_preregistration_insert
  on public.cortex_preregistrations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and lower(email) = lower((select auth.jwt())->>'email')
  );

create policy cortex_preregistration_update
  on public.cortex_preregistrations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and lower(email) = lower((select auth.jwt())->>'email')
  );

comment on table public.cortex_preregistrations is
  'Verified pre-registrants. Only the server may credit bonus tokens or send launch notifications.';
