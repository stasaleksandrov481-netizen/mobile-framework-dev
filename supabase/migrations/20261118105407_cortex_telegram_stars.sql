-- Telegram Stars are a distinct, server-owned XTR ledger. Legacy cortex_payments
-- remains the subscription entitlement/reservation record (amount in RUB kopecks).
-- Never treat its amount as actual Stars revenue.
create table public.cortex_stars_prices (
  plan text primary key references public.cortex_plans(code),
  stars integer not null check (stars between 1 and 10000),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check (plan in ('start', 'pro', 'ultra'))
);

-- Initial price parity at 17 Nov 2026: 199/399/799 RUB and ~1.0727 RUB
-- per Star of developer rewards (0.013 USD * 82.5143 RUB/USD). Prices are
-- REVIEWED values, not a client-controlled FX conversion. Opt-in remains off.
insert into public.cortex_stars_prices(plan,stars,enabled) values
  ('start',199,false),('pro',399,false),('ultra',799,false);

-- Only publishes the small price catalogue; no buyer/order/Telegram data.
create function public.cortex_stars_public_prices()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('plan',p.plan,'stars',p.stars,
    'enabled',p.enabled) order by case p.plan when 'start' then 1 when 'pro' then 2 else 3 end),
    '[]'::jsonb) from public.cortex_stars_prices p
$$;
revoke all on function public.cortex_stars_public_prices() from public;
grant execute on function public.cortex_stars_public_prices() to anon,authenticated;

create table public.cortex_stars_orders (
  id uuid primary key references public.cortex_payments(id),
  subject uuid not null,
  plan text not null references public.cortex_stars_prices(plan),
  stars integer not null check (stars between 1 and 10000),
  status text not null default 'created'
    check (status in ('created', 'invoiced', 'prechecked', 'paid', 'canceled', 'refunded')),
  invoice_url text,
  telegram_user_id bigint check (telegram_user_id > 0),
  precheckout_id text unique,
  telegram_charge_id text unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '1 hour'),
  prechecked_at timestamptz,
  reconcile_checked_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  check (telegram_charge_id is null or length(telegram_charge_id) between 1 and 128),
  check (precheckout_id is null or length(precheckout_id) between 1 and 256)
);
create index cortex_stars_orders_subject_created on public.cortex_stars_orders(subject, created_at desc);

alter table public.cortex_stars_prices enable row level security;
alter table public.cortex_stars_orders enable row level security;
revoke all on public.cortex_stars_prices, public.cortex_stars_orders from public, anon, authenticated;
grant select, insert, update on public.cortex_stars_orders to service_role;
grant select, insert, update on public.cortex_stars_prices to service_role;

-- Only an email-confirmed user with a current Supabase session can reserve a
-- subscription. Reused invoice links are declined after expiry, and prechecked
-- invoices are never discarded automatically while awaiting Telegram delivery.
create function public.cortex_stars_new_order(p_plan text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  buyer uuid := (select auth.uid());
  price public.cortex_stars_prices;
  existing public.cortex_payments;
  stars_order public.cortex_stars_orders;
  reserved jsonb;
begin
  if buyer is null or auth.role() <> 'authenticated' or not exists (
    select 1 from auth.users u where u.id = buyer and u.email_confirmed_at is not null
  ) or not exists (
    select 1 from auth.sessions s where s.user_id = buyer
      and s.id::text = (select auth.jwt()->>'session_id')
      and (s.not_after is null or s.not_after > now())
  ) then return jsonb_build_object('error', 'login_required'); end if;
  if p_plan is null or p_plan not in ('start','pro','ultra') then
    return jsonb_build_object('error', 'invalid_plan');
  end if;
  select * into price from public.cortex_stars_prices
    where plan = p_plan and enabled = true;
  if not found then return jsonb_build_object('error','stars_disabled'); end if;

  -- Shared with the ordinary billing order to serialize liability reservation.
  perform pg_advisory_xact_lock(140387,2);
  select * into existing from public.cortex_payments p
    where p.subject = buyer::text and p.mode = 'live' and p.state in ('creating','pending')
    for update;
  if found then
    select * into stars_order from public.cortex_stars_orders s
      where s.id = existing.id for update;
    if not found then return jsonb_build_object('error','other_checkout_pending'); end if;
    if stars_order.status = 'prechecked' then
      return jsonb_build_object('error','payment_processing');
    end if;
    if stars_order.status in ('created','invoiced') and stars_order.expires_at <= now() then
      perform public.cortex_billing_payment(existing.id,'live',existing.id,'canceled',existing.amount);
      update public.cortex_stars_orders set status = 'canceled' where id = existing.id;
    else
      if stars_order.plan <> p_plan then return jsonb_build_object('error','payment_pending'); end if;
      return jsonb_build_object('id',stars_order.id,'plan',stars_order.plan,
        'stars',stars_order.stars,'status',stars_order.status,'invoice_url',stars_order.invoice_url);
    end if;
  end if;

  if (select count(*) from public.cortex_stars_orders s
      where s.subject = buyer and s.created_at > now() - interval '15 minutes') >= 3 then
    return jsonb_build_object('error','rate_limited');
  end if;
  reserved := public.cortex_billing_order(buyer::text,p_plan,'live',0);
  if reserved is null or reserved ? 'error' or (reserved->>'existing')::boolean then
    return jsonb_build_object('error',coalesce(reserved->>'error','billing_unavailable'));
  end if;
  insert into public.cortex_stars_orders(id,subject,plan,stars)
    values ((reserved->>'id')::uuid,buyer,p_plan,price.stars)
    returning * into stars_order;
  return jsonb_build_object('id',stars_order.id,'plan',stars_order.plan,
    'stars',stars_order.stars,'status',stars_order.status,'invoice_url',null);
end
$$;

-- The following RPCs are service-role only. A request body from Telegram is
-- never sufficient proof: the webhook validates its secret before invoking them.
create function public.cortex_stars_invoice_ready(p_id uuid,p_url text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare item public.cortex_stars_orders; legacy public.cortex_payments; confirmed jsonb;
begin
  perform pg_advisory_xact_lock(140387,2);
  select * into item from public.cortex_stars_orders where id = p_id for update;
  if not found or item.status not in ('created','invoiced') or item.expires_at <= now() then
    return jsonb_build_object('error','invoice_unavailable');
  end if;
  if item.status = 'invoiced' then
    return jsonb_build_object('id',item.id,'invoice_url',item.invoice_url,'stars',item.stars);
  end if;
  if p_url is null or length(p_url) > 2048 or p_url !~ '^https://t[.]me/[^[:space:]]+$' then
    return jsonb_build_object('error','invalid_invoice');
  end if;
  select * into legacy from public.cortex_payments where id = p_id and mode = 'live';
  confirmed := public.cortex_billing_payment(p_id,'live',p_id,'pending',legacy.amount,p_url);
  if confirmed is null or confirmed->>'state' <> 'pending' then
    raise exception 'Stars invoice reservation mismatch' using errcode = '23514';
  end if;
  update public.cortex_stars_orders set invoice_url = p_url,status = 'invoiced' where id = p_id;
  return jsonb_build_object('id',p_id,'invoice_url',p_url,'stars',item.stars);
end
$$;

create function public.cortex_stars_precheckout(p_id uuid,p_buyer bigint,p_query text,p_stars integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare item public.cortex_stars_orders;
begin
  if p_buyer is null or p_buyer <= 0 or p_query is null or length(p_query) not between 1 and 256 then
    return jsonb_build_object('ok',false,'error','invalid_precheckout');
  end if;
  select * into item from public.cortex_stars_orders where id = p_id for update;
  if not found or item.stars <> p_stars then
    return jsonb_build_object('ok',false,'error','amount_mismatch');
  end if;
  if item.status = 'prechecked' and item.precheckout_id = p_query and item.telegram_user_id = p_buyer then
    return jsonb_build_object('ok',true);
  end if;
  if item.status <> 'invoiced' or item.expires_at <= now() then
    return jsonb_build_object('ok',false,'error','invoice_expired');
  end if;
  if not exists (select 1 from public.cortex_payments
      where id = p_id and state = 'pending' and provider_id = p_id) then
    return jsonb_build_object('ok',false,'error','order_unavailable');
  end if;
  update public.cortex_stars_orders set status = 'prechecked',telegram_user_id = p_buyer,
    precheckout_id = p_query,prechecked_at = clock_timestamp() where id = p_id;
  return jsonb_build_object('ok',true);
end
$$;

create function public.cortex_stars_confirm(p_id uuid,p_charge text,p_buyer bigint,p_stars integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare item public.cortex_stars_orders; legacy public.cortex_payments; confirmed jsonb;
begin
  if p_charge is null or length(p_charge) not between 1 and 128 or p_buyer is null or p_buyer <= 0 then
    return jsonb_build_object('ok',false,'error','invalid_payment');
  end if;
  perform pg_advisory_xact_lock(140387,2);
  select * into item from public.cortex_stars_orders where id = p_id for update;
  if not found or item.stars <> p_stars or item.telegram_user_id is distinct from p_buyer then
    return jsonb_build_object('ok',false,'error','payment_mismatch');
  end if;
  if item.status in ('paid','refunded') and item.telegram_charge_id = p_charge then
    return jsonb_build_object('ok',true,'duplicate',true,'status',item.status);
  end if;
  if item.status <> 'prechecked' or item.telegram_charge_id is not null then
    return jsonb_build_object('ok',false,'error','payment_mismatch');
  end if;
  select * into legacy from public.cortex_payments where id = p_id and mode = 'live' for update;
  if not found or legacy.state <> 'pending' or legacy.provider_id <> p_id then
    return jsonb_build_object('ok',false,'error','order_unavailable');
  end if;
  -- Unique charge ID and subscription activation succeed atomically.
  update public.cortex_stars_orders set telegram_charge_id = p_charge,status = 'paid',paid_at = clock_timestamp()
    where id = p_id;
  confirmed := public.cortex_billing_payment(p_id,'live',p_id,'confirmed',legacy.amount);
  if confirmed is null or confirmed->>'state' <> 'confirmed' then
    raise exception 'Stars settlement mismatch' using errcode = '23514';
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'status','paid');
end
$$;

create function public.cortex_stars_refund(p_charge text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare item public.cortex_stars_orders; legacy public.cortex_payments; refunded jsonb;
begin
  if p_charge is null or length(p_charge) not between 1 and 128 then
    return jsonb_build_object('ok',false,'error','invalid_refund');
  end if;
  perform pg_advisory_xact_lock(140387,2);
  select * into item from public.cortex_stars_orders where telegram_charge_id = p_charge for update;
  if not found then return jsonb_build_object('ok',false,'error','charge_not_found'); end if;
  if item.status = 'refunded' then return jsonb_build_object('ok',true,'duplicate',true); end if;
  if item.status <> 'paid' then return jsonb_build_object('ok',false,'error','not_paid'); end if;
  select * into legacy from public.cortex_payments where id = item.id and mode = 'live' for update;
  refunded := public.cortex_billing_payment(item.id,'live',item.id,'refunded',legacy.amount);
  if refunded is null or refunded->>'state' <> 'refunded' then
    raise exception 'Stars refund mismatch' using errcode = '23514';
  end if;
  update public.cortex_stars_orders set status = 'refunded',refunded_at = clock_timestamp() where id = item.id;
  return jsonb_build_object('ok',true,'duplicate',false);
end
$$;

revoke all on function public.cortex_stars_new_order(text),
  public.cortex_stars_invoice_ready(uuid,text),
  public.cortex_stars_precheckout(uuid,bigint,text,integer),
  public.cortex_stars_confirm(uuid,text,bigint,integer),
  public.cortex_stars_refund(text) from public,anon,authenticated;
grant execute on function public.cortex_stars_new_order(text) to authenticated;
grant execute on function public.cortex_stars_invoice_ready(uuid,text),
  public.cortex_stars_precheckout(uuid,bigint,text,integer),
  public.cortex_stars_confirm(uuid,text,bigint,integer),
  public.cortex_stars_refund(text) to service_role;

-- Scoped status lookup: the browser may only check its own order, never
-- initiate settlement. The response excludes Telegram payer/charge details.
create function public.cortex_stars_my_status(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare buyer uuid := auth.uid(); result jsonb;
begin
  if buyer is null or not exists (
    select 1 from auth.sessions s where s.user_id = buyer
      and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > now())
  ) then return jsonb_build_object('error','login_required'); end if;
  select jsonb_build_object('id',s.id,'plan',s.plan,'stars',s.stars,
    'status',s.status,'ends_at',p.ends_at) into result
    from public.cortex_stars_orders s
      join public.cortex_payments p on p.id = s.id
    where s.id = p_id and s.subject = buyer;
  return coalesce(result,jsonb_build_object('error','not_found'));
end
$$;
revoke all on function public.cortex_stars_my_status(uuid) from public,anon;
grant execute on function public.cortex_stars_my_status(uuid) to authenticated;

-- User-triggered fallback for a successful Telegram payment whose callback
-- was delayed or lost. Verify the session and throttle BEFORE contacting Bot
-- API. This function never confirms an order or changes an entitlement.
create function public.cortex_stars_reconcile_start(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare buyer uuid := auth.uid(); item public.cortex_stars_orders;
begin
  if buyer is null or not exists (
    select 1 from auth.sessions s where s.user_id = buyer
      and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > now())
  ) then return jsonb_build_object('error','login_required'); end if;
  select * into item from public.cortex_stars_orders
    where id = p_id and subject = buyer for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if item.status = 'paid' or item.status = 'refunded' then
    return jsonb_build_object('status',item.status);
  end if;
  if item.status <> 'prechecked' then return jsonb_build_object('status',item.status); end if;
  if item.reconcile_checked_at > now() - interval '30 seconds' then
    return jsonb_build_object('error','rate_limited');
  end if;
  update public.cortex_stars_orders set reconcile_checked_at = clock_timestamp()
    where id = item.id;
  return jsonb_build_object('status','prechecked','id',item.id,'stars',item.stars,
    'buyer',item.telegram_user_id);
end
$$;
revoke all on function public.cortex_stars_reconcile_start(uuid) from public,anon;
grant execute on function public.cortex_stars_reconcile_start(uuid) to authenticated;

-- A dedicated refund authorization endpoint for the Control server. The
-- browser never receives the payer Telegram ID or charge token: only the
-- protected server-side Control route invokes this RPC using its bearer JWT.
create function public.cortex_stars_admin_refund_prepare(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare caller uuid := auth.uid(); item public.cortex_stars_orders;
begin
  if caller is null or auth.jwt()->>'aal' <> 'aal2' or not exists (
    select 1 from auth.sessions s where s.user_id = caller
      and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > now())
  ) or not exists (
    select 1 from public.cortex_admin_roles r
    where r.user_id = caller and r.role::text = 'owner'
  ) then raise exception 'Owner MFA required' using errcode = '42501'; end if;
  select * into item from public.cortex_stars_orders where id = p_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if item.status = 'refunded' then return jsonb_build_object('status','refunded'); end if;
  if item.status <> 'paid' or item.telegram_user_id is null or item.telegram_charge_id is null then
    return jsonb_build_object('error','not_paid');
  end if;
  return jsonb_build_object('status','paid','telegram_user_id',item.telegram_user_id,
    'telegram_charge_id',item.telegram_charge_id);
end
$$;
revoke all on function public.cortex_stars_admin_refund_prepare(uuid) from public,anon,service_role;
grant execute on function public.cortex_stars_admin_refund_prepare(uuid) to authenticated;

-- Telegram requires /paysupport for disputes. Small, bounded dedup journal
-- prevents retries and command spam from multiplying outgoing Bot API calls.
create table public.cortex_telegram_command_updates (
  update_id bigint primary key check (update_id > 0),
  chat_id bigint not null check (chat_id > 0),
  created_at timestamptz not null default clock_timestamp()
);
create index cortex_telegram_command_updates_created_at
  on public.cortex_telegram_command_updates(created_at);
create index cortex_telegram_command_updates_chat_at
  on public.cortex_telegram_command_updates(chat_id,created_at desc);
alter table public.cortex_telegram_command_updates enable row level security;
revoke all on public.cortex_telegram_command_updates from public,anon,authenticated;
grant select,insert,delete on public.cortex_telegram_command_updates to service_role;

create function public.cortex_stars_claim_bot_command(p_update bigint,p_chat bigint)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare inserted bigint;
begin
  if p_update is null or p_update <= 0 or p_chat is null or p_chat <= 0 then return false; end if;
  perform pg_advisory_xact_lock(140388,hashtext(p_chat::text));
  if exists (select 1 from public.cortex_telegram_command_updates where update_id = p_update) then return false; end if;
  if (select count(*) from public.cortex_telegram_command_updates
      where chat_id = p_chat and created_at > now() - interval '5 minutes') >= 3 then return false; end if;
  insert into public.cortex_telegram_command_updates(update_id,chat_id)
    values (p_update,p_chat) on conflict do nothing returning update_id into inserted;
  -- Amortized, bounded cleanup: no unbounded table scans/deletes in a webhook.
  if p_update % 20 = 0 then
    delete from public.cortex_telegram_command_updates where update_id in (
      select update_id from public.cortex_telegram_command_updates
        where created_at < now() - interval '3 days'
        order by created_at limit 200
    );
  end if;
  return inserted is not null;
end
$$;
revoke all on function public.cortex_stars_claim_bot_command(bigint,bigint) from public,anon,authenticated;
grant execute on function public.cortex_stars_claim_bot_command(bigint,bigint) to service_role;

-- Preserve existing dashboard authorization, but correct the legacy RUB totals.
-- Stars cannot be added to kopecks: report each currency independently.
create or replace function public.cortex_admin_billing(p_action text default 'overview',p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare result jsonb; caller uuid := auth.uid();
begin
  if caller is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' or not exists (
    select 1 from auth.sessions s where s.user_id = caller
      and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > now())
  ) then raise exception 'Administrative access required' using errcode = '42501'; end if;
  -- Throws unless caller has an active, MFA-authenticated administrator session.
  result := cortex_private.admin_billing(p_action,p_data);
  return result || jsonb_build_object(
    'collected',(select coalesce(sum(p.amount),0) from public.cortex_payments p
      left join public.cortex_stars_orders s on s.id = p.id
      where p.mode = 'live' and p.state = 'confirmed' and s.id is null),
    'refunded',(select coalesce(sum(p.amount),0) from public.cortex_payments p
      left join public.cortex_stars_orders s on s.id = p.id
      where p.mode = 'live' and p.state = 'refunded' and s.id is null),
    'stars_collected',(select coalesce(sum(stars),0) from public.cortex_stars_orders where status = 'paid'),
    'stars_refunded',(select coalesce(sum(stars),0) from public.cortex_stars_orders where status = 'refunded'),
    'recent',coalesce((select jsonb_agg(
      case when s.id is not null
        then (entry.value - 'amount') || jsonb_build_object('amount',s.stars,'currency','XTR','payment_method','telegram_stars')
        else entry.value || jsonb_build_object('currency','RUB','payment_method',
          case when entry.value->>'mode' = 'manual' then 'manual' else 'platega' end)
      end order by entry.ordinality)
      from jsonb_array_elements(result->'recent') with ordinality as entry(value,ordinality)
      left join public.cortex_stars_orders s on s.id = (entry.value->>'id')::uuid),'[]'::jsonb)
  );
end
$$;
revoke all on function public.cortex_admin_billing(text,jsonb) from public,anon;
grant execute on function public.cortex_admin_billing(text,jsonb) to authenticated;

-- Owner-controlled XTR catalogue. No client, bot or webhook may choose prices.
create function public.cortex_admin_stars_prices(p_plan text default null,p_stars integer default null,
  p_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid(); is_owner boolean;
begin
  if caller is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' or not exists (
    select 1 from auth.sessions s where s.user_id = caller
      and s.id::text = auth.jwt()->>'session_id' and (s.not_after is null or s.not_after > now())
  ) then raise exception 'Administrative access required' using errcode = '42501'; end if;
  select exists(select 1 from public.cortex_admin_roles where user_id = caller and role::text = 'owner')
    into is_owner;
  if not is_owner and not exists(select 1 from public.cortex_admin_roles
      where user_id = caller and role::text = 'admin') then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;
  if p_plan is not null or p_stars is not null or p_enabled is not null then
    if not is_owner then raise exception 'Owner access required' using errcode = '42501'; end if;
    if p_plan is null or p_stars is null or p_plan not in ('start','pro','ultra') or p_stars not between 1 and 10000
      or p_enabled is null then raise exception 'Invalid Stars price' using errcode = '22023'; end if;
    insert into public.cortex_stars_prices(plan,stars,enabled) values (p_plan,p_stars,p_enabled)
      on conflict (plan) do update set stars = excluded.stars,enabled = excluded.enabled,
        updated_at = clock_timestamp();
  end if;
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.plan)
    from public.cortex_stars_prices p),'[]'::jsonb);
end
$$;
revoke all on function public.cortex_admin_stars_prices(text,integer,boolean) from public,anon;
grant execute on function public.cortex_admin_stars_prices(text,integer,boolean) to authenticated;
