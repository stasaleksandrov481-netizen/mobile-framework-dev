-- Web support shares existing tickets/replies with Android and the control panel.
-- Legacy device-only tickets remain readable by staff, never by arbitrary users.
alter table public.cortex_support
  add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.cortex_support
  alter column id set default gen_random_uuid();

create index if not exists cortex_support_owner_created_idx
  on public.cortex_support(user_id, created_at desc) where user_id is not null;
create index if not exists cortex_support_replies_ticket_created_idx
  on public.cortex_support_replies(ticket_id, created_at);

alter table public.cortex_support_replies
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_bytes integer;

alter table public.cortex_support_replies
  add constraint cortex_support_reply_attachment_safe check (
    (attachment_path is null and attachment_name is null and attachment_mime is null and attachment_bytes is null)
    or (attachment_path is not null
      and char_length(attachment_path) between 79 and 160
      and attachment_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}[.](webp|png|jpg|jpeg|pdf|mp4|webm|mp3|ogg)$'
      and char_length(attachment_name) between 1 and 120
      and attachment_mime in ('image/webp','image/png','image/jpeg','application/pdf',
                              'video/mp4','video/webm','audio/mpeg','audio/ogg','audio/webm')
      and attachment_bytes between 1 and 8388608)
  );

-- Browser users read only their own tickets. Existing staff policies stay intact.
create policy "Users read own support tickets"
  on public.cortex_support for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users open support tickets"
  on public.cortex_support for insert to authenticated
  with check (
    user_id = (select auth.uid()) and status = 'open'
    and category in ('contact','bug','idea')
    and char_length(message) between 1 and 4000
    and reply_to is null and screenshot is null and device_hash is null
  );

create policy "Users read replies to own support tickets"
  on public.cortex_support_replies for select to authenticated
  using (exists (
    select 1 from public.cortex_support ticket
    where ticket.id = ticket_id and ticket.user_id = (select auth.uid())
  ));

create policy "Users reply to own open support tickets"
  on public.cortex_support_replies for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.cortex_support ticket
      where ticket.id = ticket_id and ticket.user_id = (select auth.uid())
        and ticket.status <> 'closed'
    )
    and (attachment_path is null or
      attachment_path like (select auth.uid())::text || '/' || ticket_id::text || '/%')
  );

grant select, insert on public.cortex_support to authenticated;
grant select, insert on public.cortex_support_replies to authenticated;

-- Row policies stop cross-account access; triggers also stop direct REST spam,
-- even from clients that never call the website's application code.
create or replace function cortex_private.web_support_ticket_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  recent_count integer;
begin
  if new.user_id is null then return new; end if; -- existing Android integration
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'Invalid support account' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u
                 where u.id = new.user_id and u.email_confirmed_at is not null) then
    raise exception 'Verify your email before contacting support' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cortex:support:' || new.user_id::text, 0));
  select count(*) into recent_count from public.cortex_support
  where user_id = new.user_id and created_at > clock_timestamp() - interval '1 hour';
  if recent_count >= 3 then
    raise exception 'Too many new conversations' using errcode = '22023';
  end if;
  select count(*) into recent_count from public.cortex_support
  where user_id = new.user_id and created_at > clock_timestamp() - interval '24 hours';
  if recent_count >= 10 then
    raise exception 'Daily support limit reached' using errcode = '22023';
  end if;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

create or replace function cortex_private.web_support_reply_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  owner_id uuid;
  recent_count integer;
begin
  select user_id into owner_id from public.cortex_support where id = new.ticket_id;
  if owner_id is distinct from new.author_id then return new; end if; -- staff reply
  if auth.uid() is null or auth.uid() <> owner_id then
    raise exception 'Invalid support account' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u
                 where u.id = owner_id and u.email_confirmed_at is not null) then
    raise exception 'Verify your email before contacting support' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cortex:support:' || owner_id::text, 0));
  select count(*) into recent_count from public.cortex_support_replies
  where author_id = owner_id and created_at > clock_timestamp() - interval '10 minutes';
  if recent_count >= 20 then
    raise exception 'Too many messages' using errcode = '22023';
  end if;
  if exists (select 1 from public.cortex_support_replies
             where author_id = owner_id and created_at > clock_timestamp() - interval '3 seconds') then
    raise exception 'Wait before sending another message' using errcode = '22023';
  end if;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function cortex_private.web_support_ticket_guard() from public, anon, authenticated;
revoke all on function cortex_private.web_support_reply_guard() from public, anon, authenticated;
create trigger cortex_web_ticket_guard before insert on public.cortex_support
  for each row execute function cortex_private.web_support_ticket_guard();
create trigger cortex_web_reply_guard before insert on public.cortex_support_replies
  for each row execute function cortex_private.web_support_reply_guard();

-- Private media: browser compressors reduce images to WebP, and Storage caps
-- each file. Objects are never public, HTML/SVG uploads are forbidden.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cortex-support', 'cortex-support', false, 8388608,
        array['image/webp','image/png','image/jpeg','application/pdf',
              'video/mp4','video/webm','audio/mpeg','audio/ogg','audio/webm'])
on conflict (id) do nothing;

create policy "Users upload own support media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cortex-support'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.cortex_support t
      where t.id::text = split_part(name, '/', 2)
        and t.user_id = (select auth.uid()) and t.status <> 'closed')
  );

create policy "Users read own support media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cortex-support'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.cortex_support t
      where t.id::text = split_part(name, '/', 2) and t.user_id = (select auth.uid()))
  );

create policy "Users remove own support media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cortex-support'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Support staff read support media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cortex-support'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (select 1 from public.cortex_admin_roles a
      where a.user_id = (select auth.uid()) and a.role in ('owner','admin','support'))
  );

-- Storage quotas must also be enforced in the database, because an attacker
-- could bypass the web page and call the Storage API directly.
create or replace function cortex_private.web_support_media_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, storage, public
as $$
declare
  owner_id text;
  existing_count integer;
begin
  if new.bucket_id <> 'cortex-support' then return new; end if;
  owner_id := split_part(new.name, '/', 1);
  if auth.uid() is null or owner_id <> auth.uid()::text then
    raise exception 'Invalid media owner' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cortex:media:' || owner_id, 0));
  select count(*) into existing_count from storage.objects
  where bucket_id = 'cortex-support' and name like owner_id || '/%'
    and created_at > clock_timestamp() - interval '24 hours';
  if existing_count >= 30 then
    raise exception 'Daily attachment limit reached' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function cortex_private.web_support_media_guard() from public, anon, authenticated;
create trigger cortex_web_media_guard before insert on storage.objects
  for each row execute function cortex_private.web_support_media_guard();
