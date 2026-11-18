
-- CORTEX CONTROL: gated admin, app telemetry and support replies
create schema if not exists cortex_private;
revoke all on schema cortex_private from public, anon, authenticated;

create table if not exists cortex_private.owner_invite (
  singleton boolean primary key default true check (singleton),
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid
);
revoke all on cortex_private.owner_invite from public, anon, authenticated;

create table if not exists public.cortex_admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','support')),
  created_at timestamptz not null default now()
);
alter table public.cortex_admin_roles enable row level security;
revoke all on public.cortex_admin_roles from anon, authenticated;
grant select on public.cortex_admin_roles to authenticated;
create policy "Admins see own role" on public.cortex_admin_roles
for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.cortex_installs (
  install_hash text primary key check (length(install_hash) between 32 and 96),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  app_version text,
  platform text not null default 'android',
  last_screen text
);
create index if not exists cortex_installs_seen_idx on public.cortex_installs(last_seen_at desc);
alter table public.cortex_installs enable row level security;
revoke all on public.cortex_installs from anon, authenticated;
grant select on public.cortex_installs to authenticated;
create policy "Admin installs read" on public.cortex_installs
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar
    where ar.user_id = (select auth.uid()) and ar.role in ('owner','admin','support')
  )
);

create table if not exists public.cortex_app_sessions (
  id uuid primary key,
  install_hash text not null references public.cortex_installs(install_hash) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists cortex_app_sessions_seen_idx on public.cortex_app_sessions(last_seen_at desc);
create index if not exists cortex_app_sessions_started_idx on public.cortex_app_sessions(started_at desc);
alter table public.cortex_app_sessions enable row level security;
revoke all on public.cortex_app_sessions from anon, authenticated;
grant select on public.cortex_app_sessions to authenticated;
create policy "Admin sessions read" on public.cortex_app_sessions
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar
    where ar.user_id = (select auth.uid()) and ar.role in ('owner','admin','support')
  )
);

create table if not exists public.cortex_ai_usage (
  id bigint generated always as identity primary key,
  install_hash text,
  occurred_at timestamptz not null default now(),
  category text not null default 'chat',
  model_profile text,
  success boolean not null default true
);
create index if not exists cortex_ai_usage_time_idx on public.cortex_ai_usage(occurred_at desc);
alter table public.cortex_ai_usage enable row level security;
revoke all on public.cortex_ai_usage from anon, authenticated;
grant select on public.cortex_ai_usage to authenticated;
create policy "Admin AI usage read" on public.cortex_ai_usage
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar
    where ar.user_id = (select auth.uid()) and ar.role in ('owner','admin','support')
  )
);

alter table public.cortex_support
  add column if not exists device_hash text,
  add column if not exists status text not null default 'open';
alter table public.cortex_support
  add constraint cortex_support_status_check
    check (status in ('open','in_progress','answered','closed'));
create index if not exists cortex_support_device_idx on public.cortex_support(device_hash);
create index if not exists cortex_support_created_idx on public.cortex_support(created_at desc);
alter table public.cortex_support enable row level security;
revoke all on public.cortex_support from anon, authenticated;
grant select, update(status) on public.cortex_support to authenticated;
create policy "Support team reads tickets" on public.cortex_support
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar where ar.user_id = (select auth.uid())
      and ar.role in ('owner','admin','support')
  )
);
create policy "Support team updates ticket status" on public.cortex_support
for update to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar where ar.user_id = (select auth.uid())
      and ar.role in ('owner','admin','support')
  )
) with check (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar where ar.user_id = (select auth.uid())
      and ar.role in ('owner','admin','support')
  )
);

create table if not exists public.cortex_support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.cortex_support(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id),
  message text not null check (char_length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists cortex_support_replies_ticket_idx
 on public.cortex_support_replies(ticket_id, created_at desc);
alter table public.cortex_support_replies enable row level security;
revoke all on public.cortex_support_replies from anon, authenticated;
grant select, insert on public.cortex_support_replies to authenticated;
create policy "Support team reads replies" on public.cortex_support_replies
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar where ar.user_id = (select auth.uid())
      and ar.role in ('owner','admin','support')
  )
);
create policy "Support team writes replies" on public.cortex_support_replies
for insert to authenticated with check (
  author_id = (select auth.uid()) and
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar where ar.user_id = (select auth.uid())
      and ar.role in ('owner','admin','support')
  )
);

create table if not exists public.cortex_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  event text not null,
  target text,
  created_at timestamptz not null default now()
);
create index if not exists cortex_admin_audit_time_idx on public.cortex_admin_audit(created_at desc);
alter table public.cortex_admin_audit enable row level security;
revoke all on public.cortex_admin_audit from anon, authenticated;
grant select on public.cortex_admin_audit to authenticated;
create policy "Owner and admin audit read" on public.cortex_admin_audit
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.cortex_admin_roles ar where ar.user_id = (select auth.uid())
      and ar.role in ('owner','admin')
  )
);

create or replace function cortex_private.audit_support_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cortex_admin_audit(actor_id, event, target)
  values (new.author_id, 'support.reply', new.ticket_id::text);
  update public.cortex_support set status = 'answered' where id = new.ticket_id;
  return new;
end; $$;
revoke execute on function cortex_private.audit_support_reply() from public, anon, authenticated;
create trigger cortex_support_reply_audit after insert on public.cortex_support_replies
for each row execute function cortex_private.audit_support_reply();

create or replace function public.cortex_claim_owner(p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claimed uuid;
begin
  if (select auth.uid()) is null or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'MFA is required';
  end if;
  if not exists(select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null) then
    raise exception 'Verified email is required';
  end if;
  if char_length(p_code) <> 64 or p_code !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid activation code';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(846127221);
  if exists(select 1 from public.cortex_admin_roles where role = 'owner') then
    raise exception 'An owner already exists';
  end if;
  update cortex_private.owner_invite
  set used_at = pg_catalog.now(), used_by = (select auth.uid())
  where singleton = true and used_at is null and expires_at > pg_catalog.now()
    and token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_code,'UTF8')),'hex')
  returning used_by into v_claimed;
  if v_claimed is null then
    raise exception 'Code expired or invalid';
  end if;
  insert into public.cortex_admin_roles(user_id,role) values (v_claimed,'owner');
  insert into public.cortex_admin_audit(actor_id,event,target) values(v_claimed,'owner.activated',v_claimed::text);
  return true;
end; $$;
revoke all on function public.cortex_claim_owner(text) from public, anon;
grant execute on function public.cortex_claim_owner(text) to authenticated;
