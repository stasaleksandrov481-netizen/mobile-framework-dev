-- A reinstall replaces the random install token, not Android's app-signing-key
-- scoped device identifier. Keep one guest allowance per observed device and
-- link it irrevocably to the first signed-in account. Identifiers are hashed
-- in the trusted Edge Function before reaching this table.
create table if not exists cortex_private.ai_device_owners (
    device_hash text primary key check (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
    guest_install text not null check (guest_install ~ '^[A-Za-z0-9_-]{43}$'),
    account_subject text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table cortex_private.ai_device_owners enable row level security;
revoke all on cortex_private.ai_device_owners from public, anon, authenticated;
grant select, insert, update on cortex_private.ai_device_owners to service_role;
grant select, update on cortex_private.ai_guest_owners to service_role;

-- The RPC is service-role-only. The account subject is verified by the Edge
-- Function's session lookup; the client never supplies it to this function.
create or replace function public.cortex_ai_device_identity(
    p_install text, p_device text, p_account text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    item cortex_private.ai_device_owners%rowtype;
    previous_owner text;
begin
    if coalesce(p_install, '') !~ '^[A-Za-z0-9_-]{43}$'
        or coalesce(p_device, '') !~ '^[A-Za-z0-9_-]{43}$'
        or (p_account is not null and p_account !~ '^(yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$') then
        raise exception 'Invalid device identity' using errcode = '22023';
    end if;

    -- Identical lock ordering to token reservations prevents a concurrent
    -- login/guest generation from creating a fresh allowance after claiming.
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

    -- First login consumes the guest's history instead of minting a new budget.
    if item.account_subject is null then
        update cortex_private.ai_device_owners set account_subject = p_account, updated_at = now()
            where device_hash = p_device;
    end if;
    insert into cortex_private.ai_guest_owners(install, subject)
        values (item.guest_install, p_account) on conflict (install) do nothing;
    update public.cortex_ai_attempts set subject = p_account
        where subject = 'guest_' || item.guest_install;
    return jsonb_build_object('subject', p_account, 'other_account_on_device', false);
end
$$;

-- Legacy client login still claims its exact install token, including usage.
create or replace function public.cortex_claim_guest(p_install text, p_owner text, p_subject text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
    existing text;
begin
    if coalesce(p_install, '') !~ '^[A-Za-z0-9_-]{43}$'
        or coalesce(p_owner, '') !~ '^account_[A-Za-z0-9_-]{43}$'
        or coalesce(p_subject, '') !~ '^(yandex_[A-Za-z0-9_-]{43}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$' then
        return false;
    end if;
    perform pg_advisory_xact_lock(140387, 1);
    insert into cortex_private.ai_guest_owners(install, subject)
        values (p_install, p_subject) on conflict (install) do nothing;
    select subject into existing from cortex_private.ai_guest_owners where install = p_install;
    if existing <> p_subject then return false; end if;
    update public.cortex_ai_attempts set subject = p_subject
        where subject = 'guest_' || p_install;
    update public.cortex_support set device_hash = p_owner
        where device_hash = 'install_' || p_install;
    return true;
end
$$;

revoke execute on function public.cortex_ai_device_identity(text,text,text) from public, anon, authenticated;
grant execute on function public.cortex_ai_device_identity(text,text,text) to service_role;
