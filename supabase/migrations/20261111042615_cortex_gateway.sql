create table public.cortex_auth_flows (
  state_hash text primary key,
  poll_hash text not null unique,
  verifier text not null,
  expires_at timestamptz not null default now() + interval '5 minutes',
  stage text not null default 'pending'
    check (stage in ('pending', 'exchanging', 'approved', 'denied', 'forbidden')),
  account jsonb
);

create table public.cortex_sessions (
  token_hash text primary key,
  expires_at timestamptz not null default now() + interval '30 days',
  account jsonb not null
);

create table public.cortex_limits (
  bucket text not null,
  window_start bigint not null,
  hits integer not null check (hits > 0),
  primary key (bucket, window_start)
);

create table public.cortex_support (
  id uuid primary key,
  created_at timestamptz not null default now(),
  category text not null check (category in ('contact', 'bug', 'idea')),
  message text not null check (char_length(message) between 1 and 4000),
  reply_to text check (char_length(reply_to) <= 254),
  app_version text check (char_length(app_version) <= 24),
  screenshot text check (char_length(screenshot) <= 685024)
);

create index cortex_auth_expiry on public.cortex_auth_flows (expires_at);
create index cortex_session_expiry on public.cortex_sessions (expires_at);
create index cortex_limit_expiry on public.cortex_limits (window_start);

alter table public.cortex_auth_flows enable row level security;
alter table public.cortex_sessions enable row level security;
alter table public.cortex_limits enable row level security;
alter table public.cortex_support enable row level security;

revoke all on public.cortex_auth_flows, public.cortex_sessions, public.cortex_limits, public.cortex_support
  from public, anon, authenticated;
grant select, insert, update, delete on public.cortex_auth_flows, public.cortex_sessions, public.cortex_limits
  to service_role;
grant insert on public.cortex_support to service_role;
grant select (id) on public.cortex_support to service_role;

create function public.cortex_reserve(p_limits jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rule record;
  window_at bigint;
begin
  delete from public.cortex_limits where window_start < extract(epoch from now()) - 172800;
  for rule in
    select entry.bucket, entry.seconds, entry.maximum
    from jsonb_to_recordset(p_limits) as entry(bucket text, seconds integer, maximum integer)
    order by entry.bucket
  loop
    window_at := floor(extract(epoch from now()) / rule.seconds)::bigint * rule.seconds;
    insert into public.cortex_limits as quota (bucket, window_start, hits)
      values (rule.bucket, window_at, 1)
      on conflict (bucket, window_start) do update set hits = quota.hits + 1
      where quota.hits < rule.maximum;
    if not found then
      raise sqlstate 'PT429' using message = 'rate_limit';
    end if;
  end loop;
end;
$$;

create function public.cortex_begin_login(p_state_hash text, p_poll_hash text, p_verifier text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.cortex_auth_flows where expires_at <= now();
  delete from public.cortex_sessions where expires_at <= now();
  insert into public.cortex_auth_flows (state_hash, poll_hash, verifier)
    values (p_state_hash, p_poll_hash, p_verifier);
end;
$$;

create function public.cortex_finish_login(p_poll_hash text, p_token_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  flow public.cortex_auth_flows%rowtype;
begin
  select * into flow
    from public.cortex_auth_flows
    where poll_hash = p_poll_hash and expires_at > now()
    for update;
  if not found then
    return jsonb_build_object('state', 'expired');
  end if;
  if flow.stage in ('denied', 'forbidden') then
    delete from public.cortex_auth_flows where state_hash = flow.state_hash;
    return jsonb_build_object('state', flow.stage);
  end if;
  if flow.stage <> 'approved' then
    return jsonb_build_object('state', 'pending');
  end if;
  insert into public.cortex_sessions (token_hash, account) values (p_token_hash, flow.account);
  delete from public.cortex_auth_flows where state_hash = flow.state_hash;
  return jsonb_build_object('state', 'signed_in', 'account', flow.account);
end;
$$;

create function public.cortex_provider_key()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cortex_openrouter_api_key';
$$;

revoke all on function public.cortex_reserve(jsonb),
  public.cortex_begin_login(text, text, text), public.cortex_finish_login(text, text), public.cortex_provider_key()
  from public, anon, authenticated;
grant execute on function public.cortex_reserve(jsonb),
  public.cortex_begin_login(text, text, text), public.cortex_finish_login(text, text), public.cortex_provider_key()
  to service_role;
