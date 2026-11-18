
create table if not exists public.cortex_control_config (
  singleton boolean primary key default true check (singleton),
  maintenance_enabled boolean not null default false,
  maintenance_message text not null default 'Мы улучшаем CORTEX. Попробуйте войти немного позже.',
  block_old_versions boolean not null default false,
  min_version_code integer not null default 1 check (min_version_code between 1 and 10000000),
  update_url text not null default 'https://github.com/stasaleksandrov481-netizen/CORTEX/releases',
  updated_at timestamptz not null default now()
);
insert into public.cortex_control_config(singleton) values(true) on conflict do nothing;
alter table public.cortex_control_config enable row level security;
revoke all on public.cortex_control_config from anon, authenticated;
grant select, update(maintenance_enabled, maintenance_message, block_old_versions,min_version_code,update_url,updated_at)
 on public.cortex_control_config to authenticated;
create policy "Control staff view" on public.cortex_control_config for select to authenticated
using ((select auth.jwt()->>'aal') = 'aal2' and exists (
select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid()) and r.role in ('owner','admin','support')
));
create policy "Owner and admin config edits" on public.cortex_control_config for update to authenticated
using ((select auth.jwt()->>'aal') = 'aal2' and exists (
select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid()) and r.role in ('owner','admin')
))
with check ((select auth.jwt()->>'aal') = 'aal2' and exists (
select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid()) and r.role in ('owner','admin')
));

create table if not exists public.cortex_release_versions (
  version_code integer primary key check(version_code between 1 and 10000000),
  version_name text not null check(char_length(version_name) between 1 and 24),
  access text not null default 'allowed' check(access in ('allowed','blocked')),
  notes text not null default '',
  created_at timestamptz not null default now()
);
insert into public.cortex_release_versions(version_code,version_name,access)
values(91,'0.9.1','allowed') on conflict do nothing;
alter table public.cortex_release_versions enable row level security;
revoke all on public.cortex_release_versions from anon, authenticated;
grant select,insert,update(version_name,access,notes),delete on public.cortex_release_versions to authenticated;
create policy "Release versions staff view" on public.cortex_release_versions for select to authenticated
using ((select auth.jwt()->>'aal') = 'aal2' and exists (
select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid()) and r.role in ('owner','admin','support')
));
create policy "Release versions staff create" on public.cortex_release_versions for insert to authenticated
with check ((select auth.jwt()->>'aal') = 'aal2' and exists (
select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid()) and r.role in ('owner','admin')
));
create policy "Release versions staff update" on public.cortex_release_versions for update to authenticated
using ((select auth.jwt()->>'aal') = 'aal2' and exists (
select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid()) and r.role in ('owner','admin')
)) with check ((select auth.jwt()->>'aal') = 'aal2' and exists (
select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid()) and r.role in ('owner','admin')
));
create policy "Release versions staff delete" on public.cortex_release_versions for delete to authenticated
using ((select auth.jwt()->>'aal') = 'aal2' and exists (
select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid()) and r.role in ('owner','admin')
));

create or replace function public.cortex_admin_overview()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.jwt()->>'aal') is distinct from 'aal2' or not exists(
    select 1 from public.cortex_admin_roles r where r.user_id = (select auth.uid())
  ) then raise exception 'Access denied'; end if;
  select pg_catalog.jsonb_build_object(
    'total_installs', (select count(*) from public.cortex_installs),
    'active_installs', (select count(distinct install_hash) from public.cortex_app_sessions where last_seen_at >= now()-interval '100 seconds'),
    'total_launches', (select count(*) from public.cortex_app_sessions),
    'launches_today', (select count(*) from public.cortex_app_sessions where started_at >= date_trunc('day',now())),
    'support_open', (select count(*) from public.cortex_support where status in ('open','in_progress')),
    'support_all', (select count(*) from public.cortex_support),
    'ai_today', (select count(*) from public.cortex_ai_usage where occurred_at >= date_trunc('day',now())),
    'usage_last_7_days',(
      select coalesce(jsonb_agg(jsonb_build_object('date', day::date,'launches',coalesce(total,0)) order by day),'[]'::jsonb)
      from generate_series(date_trunc('day',now())-interval '6 days',date_trunc('day',now()), interval '1 day') day
      left join (select date_trunc('day',started_at) at time zone 'UTC' as daily,count(*) as total
      from public.cortex_app_sessions where started_at >= now()-interval '7 days'
      group by 1) stats on stats.daily = day at time zone 'UTC'
    )
  ) into result;
  return result;
end; $$;
revoke all on function public.cortex_admin_overview() from public, anon;
grant execute on function public.cortex_admin_overview() to authenticated;

create or replace function cortex_private.audit_control_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.cortex_admin_audit(actor_id,event,target)
 values(auth.uid(),'config.changed',
 case when old.maintenance_enabled is distinct from new.maintenance_enabled then 'maintenance:'||new.maintenance_enabled::text
 when old.block_old_versions is distinct from new.block_old_versions then 'versions:'||new.block_old_versions::text
 else 'settings' end);
 return new;
end; $$;
revoke all on function cortex_private.audit_control_changes() from public,anon,authenticated;
create trigger cortex_config_audit after update on public.cortex_control_config
for each row execute function cortex_private.audit_control_changes();
