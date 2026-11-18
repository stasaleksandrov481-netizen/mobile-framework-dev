
create or replace function public.cortex_set_admin_role(p_email text, p_role text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_id uuid; existing_role text;
begin
  if (select auth.jwt()->>'aal') is distinct from 'aal2' or not exists (
    select 1 from public.cortex_admin_roles
    where user_id=(select auth.uid()) and role='owner'
  ) then raise exception 'Owner MFA required'; end if;
  if p_role not in ('admin','support','remove') then raise exception 'Invalid role'; end if;
  if length(p_email) > 254 then raise exception 'Invalid email'; end if;
  select id into target_id from auth.users
  where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null
  limit 1;
  if target_id is null then raise exception 'User must register and verify email first'; end if;
  select role into existing_role from public.cortex_admin_roles where user_id=target_id;
  if existing_role='owner' then raise exception 'Cannot change owner'; end if;
  if p_role='remove' then
    delete from public.cortex_admin_roles where user_id=target_id;
  else
    insert into public.cortex_admin_roles(user_id,role) values(target_id,p_role)
    on conflict(user_id) do update set role=excluded.role;
  end if;
  insert into public.cortex_admin_audit(actor_id,event,target)
  values(auth.uid(),'role.changed',target_id::text||':'||p_role);
  return true;
end; $$;
revoke all on function public.cortex_set_admin_role(text,text) from public, anon;
grant execute on function public.cortex_set_admin_role(text,text) to authenticated;

create or replace function public.cortex_list_admin_roles()
returns table(user_id uuid,email text,role text,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.jwt()->>'aal') is distinct from 'aal2' or not exists (
    select 1 from public.cortex_admin_roles
    where user_id=(select auth.uid()) and role='owner'
  ) then raise exception 'Access denied'; end if;
  return query select r.user_id,u.email::text,r.role,r.created_at
  from public.cortex_admin_roles r join auth.users u on u.id=r.user_id
  order by r.created_at;
end; $$;
revoke all on function public.cortex_list_admin_roles() from public,anon;
grant execute on function public.cortex_list_admin_roles() to authenticated;

-- The first owner must claim with verified identity, a second factor and a one-time token.
-- Never automatically grant owner to any freshly registered user.
