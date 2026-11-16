-- Verified users' acceptance of the exact registration documents.
-- The database, never the caller, selects the version and records the time.
create table if not exists public.cortex_registration_legal_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_version text not null check (document_version = '2026-11-16'),
  accepted_at timestamptz not null default clock_timestamp(),
  primary key (user_id, document_version)
);

alter table public.cortex_registration_legal_acceptances enable row level security;
revoke all on public.cortex_registration_legal_acceptances from public, anon, authenticated;
grant select on public.cortex_registration_legal_acceptances to authenticated;
grant select, insert on public.cortex_registration_legal_acceptances to service_role;

create policy cortex_registration_legal_read_own
  on public.cortex_registration_legal_acceptances for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.cortex_record_registration_acceptance()
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := (select auth.uid());
  registration_metadata jsonb;
  recorded_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select u.raw_user_meta_data into registration_metadata
    from auth.users u
    where u.id = current_user_id and u.email_confirmed_at is not null;

  if not found or registration_metadata->>'cortex_privacy_acknowledged_version' is distinct from '2026-11-16'
      or registration_metadata->>'cortex_terms_accepted_version' is distinct from '2026-11-16'
      or not exists (
        select 1 from public.cortex_preregistrations p where p.user_id = current_user_id
      ) then
    raise exception 'Registration acceptance missing' using errcode = '42501';
  end if;

  insert into public.cortex_registration_legal_acceptances(user_id, document_version)
    values (current_user_id, '2026-11-16')
    on conflict (user_id, document_version) do nothing;

  select a.accepted_at into recorded_at
    from public.cortex_registration_legal_acceptances a
    where a.user_id = current_user_id and a.document_version = '2026-11-16';

  return recorded_at;
end;
$$;

revoke all on function public.cortex_record_registration_acceptance() from public, anon, authenticated;
grant execute on function public.cortex_record_registration_acceptance() to authenticated;
