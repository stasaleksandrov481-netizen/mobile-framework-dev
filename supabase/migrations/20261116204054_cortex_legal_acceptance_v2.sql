-- Keep historical consents while recording the revised co-operator documents
-- under a distinct immutable version. Prior acceptances are never rewritten.
alter table public.cortex_registration_legal_acceptances
  drop constraint cortex_registration_legal_acceptances_document_version_check;

alter table public.cortex_registration_legal_acceptances
  add constraint cortex_registration_legal_acceptances_document_version_check
  check (document_version in ('2026-11-16', '2026-11-16.2'));

create or replace function public.cortex_record_registration_acceptance()
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := (select auth.uid());
  registration_metadata jsonb;
  legal_version text;
  recorded_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select u.raw_user_meta_data into registration_metadata
    from auth.users u
    where u.id = current_user_id and u.email_confirmed_at is not null;

  legal_version := registration_metadata->>'cortex_privacy_acknowledged_version';
  if not found or legal_version is null
      or legal_version not in ('2026-11-16', '2026-11-16.2')
      or registration_metadata->>'cortex_terms_accepted_version' is distinct from legal_version
      or not exists (
        select 1 from public.cortex_preregistrations p where p.user_id = current_user_id
      ) then
    raise exception 'Registration acceptance missing' using errcode = '42501';
  end if;

  insert into public.cortex_registration_legal_acceptances(user_id, document_version)
    values (current_user_id, legal_version)
    on conflict (user_id, document_version) do nothing;

  select a.accepted_at into recorded_at
    from public.cortex_registration_legal_acceptances a
    where a.user_id = current_user_id and a.document_version = legal_version;

  return recorded_at;
end;
$$;

revoke all on function public.cortex_record_registration_acceptance() from public, anon, authenticated;
grant execute on function public.cortex_record_registration_acceptance() to authenticated;
