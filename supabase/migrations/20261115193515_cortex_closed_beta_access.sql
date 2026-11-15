-- CORTEX closed beta. Client credentials never grant access to these tables.
create table public.cortex_beta_testers (
    email text primary key check (email = lower(email) and length(email) between 5 and 254),
    state text not null default 'active' check (state in ('active', 'revoked')),
    max_devices integer not null default 1 check (max_devices between 1 and 5),
    expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.cortex_beta_devices (
    email text not null references public.cortex_beta_testers(email) on delete cascade,
    install_hash text not null check (install_hash ~ '^[a-f0-9]{64}$'),
    account_id text not null check (length(account_id) between 8 and 100),
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    primary key (email, install_hash)
);

create index cortex_beta_devices_install_idx on public.cortex_beta_devices(install_hash);
alter table public.cortex_beta_testers enable row level security;
alter table public.cortex_beta_devices enable row level security;
revoke all on public.cortex_beta_testers, public.cortex_beta_devices from public, anon, authenticated;
grant select, insert, update, delete on public.cortex_beta_testers, public.cortex_beta_devices to service_role;

alter table public.cortex_control_config
    add column beta_enabled boolean not null default false,
    add column beta_message text not null default 'CORTEX пока доступен только участникам закрытого тестирования.';

-- Called only by the Edge Function with its service-role key. Serializing on
-- the tester row prevents simultaneous devices from bypassing the limit.
create function public.cortex_beta_admit(p_email text, p_account text, p_install text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    invite public.cortex_beta_testers%rowtype;
    linked text;
    devices integer;
begin
    if p_email is null or p_account is null or p_install !~ '^[a-f0-9]{64}$' then return false; end if;
    select * into invite from public.cortex_beta_testers
        where email = lower(p_email) for update;
    if not found or invite.state <> 'active' or (invite.expires_at is not null and invite.expires_at <= now()) then
        return false;
    end if;
    select account_id into linked from public.cortex_beta_devices
        where email = invite.email and install_hash = p_install;
    if found then
        if linked <> p_account then return false; end if;
        update public.cortex_beta_devices set last_seen_at = now()
            where email = invite.email and install_hash = p_install;
        return true;
    end if;
    select count(*) into devices from public.cortex_beta_devices where email = invite.email;
    if devices >= invite.max_devices then return false; end if;
    -- Installation identifiers are hashed in the gateway, not hardware IDs.
    insert into public.cortex_beta_devices(email, install_hash, account_id)
        values (invite.email, p_install, p_account);
    return true;
end;
$$;

revoke all on function public.cortex_beta_admit(text, text, text) from public, anon, authenticated;
grant execute on function public.cortex_beta_admit(text, text, text) to service_role;

-- Administer invitations with Supabase Auth AAL2 and a trusted admin role.
-- No direct browser access to the beta tables is allowed.
create function public.cortex_admin_beta(
    p_operation text default 'list',
    p_email text default null,
    p_max_devices integer default 1,
    p_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    who uuid := (select auth.uid());
    normalized text := lower(trim(coalesce(p_email, '')));
    output jsonb;
begin
    if who is null or coalesce((select auth.jwt()->>'aal'), '') <> 'aal2' or not exists (
        select 1 from public.cortex_admin_roles
        where user_id = who and role in ('owner', 'admin')
    ) then raise exception 'Admin MFA required' using errcode = '42501'; end if;

    if p_operation = 'list' then
        select coalesce(jsonb_agg(jsonb_build_object(
            'email', t.email, 'state', t.state, 'max_devices', t.max_devices,
            'expires_at', t.expires_at, 'devices',
                (select count(*) from public.cortex_beta_devices d where d.email = t.email)
        ) order by t.created_at desc), '[]'::jsonb) into output
        from (select * from public.cortex_beta_testers order by created_at desc limit 200) t;
        return output;
    end if;
    if normalized !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$'
        or length(normalized) > 254 then raise exception 'Invalid email' using errcode = '22023'; end if;

    if p_operation = 'grant' then
        if p_max_devices not between 1 and 5 then raise exception 'Invalid device limit' using errcode = '22023'; end if;
        insert into public.cortex_beta_testers(email, state, max_devices, expires_at)
            values (normalized, 'active', p_max_devices, p_expires_at)
            on conflict (email) do update set state = 'active', max_devices = excluded.max_devices,
                expires_at = excluded.expires_at, updated_at = now();
    elsif p_operation = 'revoke' then
        update public.cortex_beta_testers set state = 'revoked', updated_at = now()
            where email = normalized;
    elsif p_operation = 'restore' then
        update public.cortex_beta_testers set state = 'active', updated_at = now()
            where email = normalized;
    elsif p_operation = 'reset_devices' then
        delete from public.cortex_beta_devices where email = normalized;
    else raise exception 'Unknown operation' using errcode = '22023'; end if;

    insert into public.cortex_admin_audit(actor_id, event, target)
        values (who, 'beta_' || p_operation, normalized);
    return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.cortex_admin_beta(text, text, integer, timestamptz) from public, anon;
grant execute on function public.cortex_admin_beta(text, text, integer, timestamptz) to authenticated;

-- APKs are never served from a public bucket. Only staff with MFA can upload
-- and create short-lived signed download URLs for individually approved testers.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('cortex-beta-builds', 'cortex-beta-builds', false, 157286400,
    array['application/vnd.android.package-archive', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "CORTEX beta staff read APKs" on storage.objects for select to authenticated
using (
    bucket_id = 'cortex-beta-builds'
    and (select auth.jwt()->>'aal') = 'aal2'
    and exists (select 1 from public.cortex_admin_roles r
        where r.user_id = (select auth.uid()) and r.role in ('owner', 'admin'))
);

create policy "CORTEX beta staff upload APKs" on storage.objects for insert to authenticated
with check (
    bucket_id = 'cortex-beta-builds' and name ~ '^cortex-[0-9]{10,15}\.apk$'
    and (select auth.jwt()->>'aal') = 'aal2'
    and exists (select 1 from public.cortex_admin_roles r
        where r.user_id = (select auth.uid()) and r.role in ('owner', 'admin'))
);
