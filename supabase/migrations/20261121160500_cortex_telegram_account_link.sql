-- CORTEX ↔ Telegram: signed-in web account + private bot chat, two-sided confirmation.
-- No Telegram ID can be linked from an unverified browser field.
create table public.cortex_telegram_account_links (
  account_id uuid primary key references auth.users(id) on delete cascade,
  telegram_id bigint unique check (telegram_id > 0),
  telegram_username text check (telegram_username is null or length(telegram_username) <= 32),
  telegram_name text check (telegram_name is null or length(telegram_name) <= 100),
  token_sha256 text unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending','linked')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cortex_telegram_link_state_valid check (
    (state = 'pending' and telegram_id is null and token_sha256 is not null and expires_at is not null)
    or (state = 'linked' and telegram_id is not null and token_sha256 is null and expires_at is null)
  )
);
create index cortex_telegram_account_links_expiry on public.cortex_telegram_account_links(expires_at)
  where expires_at is not null;
alter table public.cortex_telegram_account_links enable row level security;
revoke all on public.cortex_telegram_account_links from public, anon, authenticated;
grant select, insert, update, delete on public.cortex_telegram_account_links to service_role;

-- A valid JWT alone is not proof that the Auth session still exists.
create function public.cortex_telegram_active_session()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users u
      join auth.sessions s on s.user_id = u.id
      where u.id = auth.uid()
        and u.email_confirmed_at is not null
        and s.id::text = auth.jwt()->>'session_id'
        and (s.not_after is null or s.not_after > now())
  );
$$;
revoke all on function public.cortex_telegram_active_session() from public, anon, authenticated;
grant execute on function public.cortex_telegram_active_session() to authenticated;

-- Deduplicate all bot updates, including inline callbacks, with bounded per-chat rate control.
create table public.cortex_telegram_bot_events (
  update_id bigint primary key check (update_id > 0),
  chat_id bigint not null check (chat_id > 0),
  created_at timestamptz not null default now()
);
create index cortex_telegram_bot_events_chat_time on public.cortex_telegram_bot_events(chat_id, created_at desc);
alter table public.cortex_telegram_bot_events enable row level security;
revoke all on public.cortex_telegram_bot_events from public, anon, authenticated;
grant select, insert, delete on public.cortex_telegram_bot_events to service_role;

create function public.cortex_telegram_claim_update(p_update bigint, p_chat bigint)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare accepted bigint;
begin
  if p_update is null or p_update <= 0 or p_chat is null or p_chat <= 0 then return false; end if;
  perform pg_advisory_xact_lock(140389, hashtext(p_chat::text));
  if exists (select 1 from public.cortex_telegram_bot_events where update_id = p_update) then return false; end if;
  if (select count(*) from public.cortex_telegram_bot_events
      where chat_id = p_chat and created_at > now() - interval '1 minute') >= 30 then return false; end if;
  insert into public.cortex_telegram_bot_events(update_id, chat_id)
    values (p_update, p_chat) on conflict do nothing returning update_id into accepted;
  if p_update % 20 = 0 then
    delete from public.cortex_telegram_bot_events where update_id in (
      select update_id from public.cortex_telegram_bot_events
      where created_at < now() - interval '3 days' order by created_at limit 200
    );
  end if;
  return accepted is not null;
end
$$;
revoke all on function public.cortex_telegram_claim_update(bigint,bigint) from public, anon, authenticated;
grant execute on function public.cortex_telegram_claim_update(bigint,bigint) to service_role;
