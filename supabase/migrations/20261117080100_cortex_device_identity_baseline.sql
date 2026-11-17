-- Baseline the production v44 guest/device ownership contract in source control.
-- Verified against the live schema and pg_get_functiondef on 2026-11-17.
-- This migration is additive/idempotent on an existing deployment.
-- Device IDs and installation IDs are SHA-256 hashes here; caller-supplied
-- X-Cortex-Device is NOT a trusted hardware or app attestation.

create schema if not exists cortex_private;

create table if not exists cortex_private.ai_device_owners (
  device_hash text primary key
    constraint ai_device_owners_device_hash_check check (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
  guest_install text not null
    constraint ai_device_owners_guest_install_check check (guest_install ~ '^[A-Za-z0-9_-]{43}$'),
  account_subject text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Created in 20261115150023_cortex_token_budget.sql on a fresh database.
create table if not exists cortex_private.ai_guest_owners (
  install text primary key,
  subject text not null
);

alter table cortex_private.ai_device_owners enable row level security;
alter table cortex_private.ai_guest_owners enable row level security;

revoke all on cortex_private.ai_device_owners, cortex_private.ai_guest_owners
  from public, anon, authenticated;
grant usage on schema cortex_private to service_role;
grant select, insert, update on cortex_private.ai_device_owners to service_role;
grant select, insert, update on cortex_private.ai_guest_owners to service_role;

create or replace function public.cortex_ai_device_identity(
  p_install text,
  p_device text,
  p_account text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  item cortex_private.ai_device_owners%rowtype;
  previous_owner text;
begin
  if coalesce(p_install, '') !~ '^[A-Za-z0-9_-]{43}$'
      or coalesce(p_device, '') !~ '^[A-Za-z0-9_-]{43}$'
      or (p_account is not null
          and p_account !~ '^(yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$')
  then
    raise exception 'Invalid device identity' using errcode = '22023';
  end if;

  -- Match the ordering in cortex_ai_reserve to prevent concurrent guest
  -- reservations from receiving a new free allowance after account claiming.
  perform pg_advisory_xact_lock(140387, 1);
  insert into cortex_private.ai_device_owners(device_hash, guest_install)
    values (p_device, p_install) on conflict (device_hash) do nothing;
  select * into strict item from cortex_private.ai_device_owners
    where device_hash = p_device for update;
  select subject into previous_owner from cortex_private.ai_guest_owners
    where install = item.guest_install;

  if p_account is null then
    if item.account_subject is not null or previous_owner is not null then
      return jsonb_build_object('account_required', true);
    end if;
    return jsonb_build_object('subject', 'guest_' || item.guest_install, 'account_required', false);
  end if;

  if item.account_subject is not null and item.account_subject <> p_account then
    return jsonb_build_object('subject', p_account, 'other_account_on_device', true);
  end if;
  if previous_owner is not null and previous_owner <> p_account then
    return jsonb_build_object('subject', p_account, 'other_account_on_device', true);
  end if;

  if item.account_subject is null then
    update cortex_private.ai_device_owners
      set account_subject = p_account, updated_at = now()
      where device_hash = p_device;
  end if;
  insert into cortex_private.ai_guest_owners(install, subject)
    values (item.guest_install, p_account) on conflict (install) do nothing;
  update public.cortex_ai_attempts
    set subject = p_account
    where subject = 'guest_' || item.guest_install;

  return jsonb_build_object('subject', p_account, 'other_account_on_device', false);
end
$function$;

-- PostgREST functions are executable by PUBLIC unless explicitly revoked.
-- This invoker function is a private server-to-database RPC only.
revoke all on function public.cortex_ai_device_identity(text, text, text)
  from public, anon, authenticated;
grant execute on function public.cortex_ai_device_identity(text, text, text)
  to service_role;
