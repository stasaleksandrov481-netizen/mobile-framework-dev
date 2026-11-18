-- Read cursors are server-authored. Clients may acknowledge only messages they
-- actually fetched, and a normal account cannot acknowledge on behalf of staff.
create table if not exists public.cortex_support_reads (
  ticket_id uuid primary key references public.cortex_support(id) on delete cascade,
  user_seen_at timestamptz,
  staff_seen_at timestamptz
);

alter table public.cortex_support_reads enable row level security;

create policy "Ticket participants see support read receipts"
  on public.cortex_support_reads for select to authenticated
  using (
    exists (
      select 1 from public.cortex_support t
      where t.id = ticket_id and t.user_id = (select auth.uid())
    )
    or (
      (select auth.jwt() ->> 'aal') = 'aal2'
      and exists (
        select 1 from public.cortex_admin_roles ar
        where ar.user_id = (select auth.uid())
          and ar.role in ('owner', 'admin', 'support')
      )
    )
  );

grant select on public.cortex_support_reads to authenticated;
revoke insert, update, delete on public.cortex_support_reads from anon, authenticated;

create or replace function public.cortex_support_mark_read(
  p_ticket_id uuid,
  p_last_reply_id uuid default null,
  p_side text default 'user'
) returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_seen_at timestamptz;
begin
  if v_actor is null or p_side not in ('user', 'staff') then
    raise exception 'Invalid support reader' using errcode = '42501';
  end if;

  select t.user_id, t.created_at into v_owner, v_seen_at
  from public.cortex_support t where t.id = p_ticket_id;
  if not found then
    raise exception 'Support conversation not found' using errcode = '42501';
  end if;

  if p_side = 'user' then
    if v_owner is distinct from v_actor then
      raise exception 'Not your support conversation' using errcode = '42501';
    end if;
  elsif (auth.jwt() ->> 'aal') is distinct from 'aal2'
    or not exists (
      select 1 from public.cortex_admin_roles ar
      where ar.user_id = v_actor and ar.role in ('owner', 'admin', 'support')
    ) then
    raise exception 'Support staff authentication required' using errcode = '42501';
  end if;

  if p_last_reply_id is not null then
    select r.created_at into v_seen_at
    from public.cortex_support_replies r
    where r.id = p_last_reply_id and r.ticket_id = p_ticket_id;
    if not found then
      raise exception 'Message not found in this conversation' using errcode = '42501';
    end if;
  end if;

  insert into public.cortex_support_reads (ticket_id, user_seen_at, staff_seen_at)
  values (
    p_ticket_id,
    case when p_side = 'user' then v_seen_at end,
    case when p_side = 'staff' then v_seen_at end
  )
  on conflict (ticket_id) do update set
    user_seen_at = case when p_side = 'user' then
      greatest(public.cortex_support_reads.user_seen_at, excluded.user_seen_at)
      else public.cortex_support_reads.user_seen_at end,
    staff_seen_at = case when p_side = 'staff' then
      greatest(public.cortex_support_reads.staff_seen_at, excluded.staff_seen_at)
      else public.cortex_support_reads.staff_seen_at end
  where (p_side = 'user' and coalesce(public.cortex_support_reads.user_seen_at, '-infinity'::timestamptz) < v_seen_at)
     or (p_side = 'staff' and coalesce(public.cortex_support_reads.staff_seen_at, '-infinity'::timestamptz) < v_seen_at);

  return v_seen_at;
end;
$$;

-- A single compact query powers unread badges for both clients. No raw reply
-- bodies leave this function; every visible ticket is authorization-scoped.
create or replace function public.cortex_support_receipt_overview(
  p_side text default 'user'
) returns table (
  ticket_id uuid,
  user_seen_at timestamptz,
  staff_seen_at timestamptz,
  unread_count integer
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_side not in ('user', 'staff') then
    raise exception 'Invalid support reader' using errcode = '42501';
  end if;
  if p_side = 'staff' and (
    (auth.jwt() ->> 'aal') is distinct from 'aal2'
    or not exists (
      select 1 from public.cortex_admin_roles ar
      where ar.user_id = v_actor and ar.role in ('owner', 'admin', 'support')
    )
  ) then
    raise exception 'Support staff authentication required' using errcode = '42501';
  end if;

  return query
  with visible as (
    select t.id, t.user_id, t.created_at
    from public.cortex_support t
    where p_side = 'staff' or t.user_id = v_actor
    order by t.created_at desc
    limit (case when p_side = 'staff' then 200 else 50 end)
  )
  select v.id, s.user_seen_at, s.staff_seen_at,
    (case when p_side = 'staff' then
      (case when v.created_at > coalesce(s.staff_seen_at, '-infinity'::timestamptz) then 1 else 0 end)
      + (select count(*)::integer from public.cortex_support_replies r
         where r.ticket_id = v.id and r.author_id = v.user_id
           and r.created_at > coalesce(s.staff_seen_at, '-infinity'::timestamptz))
    else
      (select count(*)::integer from public.cortex_support_replies r
         where r.ticket_id = v.id and r.author_id is distinct from v_actor
           and r.created_at > coalesce(s.user_seen_at, '-infinity'::timestamptz))
    end)::integer
  from visible v
  left join public.cortex_support_reads s on s.ticket_id = v.id;
end;
$$;

revoke all on function public.cortex_support_mark_read(uuid, uuid, text) from public, anon;
revoke all on function public.cortex_support_receipt_overview(text) from public, anon;
grant execute on function public.cortex_support_mark_read(uuid, uuid, text) to authenticated;
grant execute on function public.cortex_support_receipt_overview(text) to authenticated;
