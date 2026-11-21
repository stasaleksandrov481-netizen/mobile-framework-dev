-- Direct Telegram Stars checkout using the existing order, liability and settlement ledger.
-- Deploy this migration before the bot release. The new RPC is not public.
alter table public.cortex_stars_orders add column expected_telegram_id bigint check (expected_telegram_id>0);

create function public.cortex_stars_bot_new_order(p_telegram bigint,p_plan text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  buyer uuid;
  price public.cortex_stars_prices;
  existing public.cortex_payments;
  stars_order public.cortex_stars_orders;
  reserved jsonb;
begin
  if p_telegram is null or p_telegram <= 0 then
    return jsonb_build_object('error','link_required');
  end if;
  -- Same lock as web checkout; resolve the linked identity inside the transaction.
  perform pg_advisory_xact_lock(140387,2);
  select l.account_id into buyer from public.cortex_telegram_account_links l
    join auth.users u on u.id=l.account_id
    where l.telegram_id=p_telegram and l.state='linked'
      and u.email_confirmed_at is not null
    for share of l;
  if not found then return jsonb_build_object('error','link_required'); end if;
  if p_plan is null or p_plan not in ('start','pro','ultra') then
    return jsonb_build_object('error', 'invalid_plan');
  end if;
  select * into price from public.cortex_stars_prices
    where plan = p_plan and enabled = true;
  if not found then return jsonb_build_object('error','stars_disabled'); end if;

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
      if stars_order.plan <> p_plan or stars_order.status not in ('created','invoiced') then return jsonb_build_object('error','payment_pending'); end if;
      if stars_order.expected_telegram_id is not null and stars_order.expected_telegram_id <> p_telegram then
        return jsonb_build_object('error','payment_pending');
      end if;
      -- An existing unconfirmed web order can be reused only for this linked account.
      update public.cortex_stars_orders set expected_telegram_id=p_telegram where id=stars_order.id;
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
  insert into public.cortex_stars_orders(id,subject,plan,stars,expected_telegram_id)
    values ((reserved->>'id')::uuid,buyer,p_plan,price.stars,p_telegram)
    returning * into stars_order;
  return jsonb_build_object('id',stars_order.id,'plan',stars_order.plan,
    'stars',stars_order.stars,'status',stars_order.status,'invoice_url',null);
end
$$;

revoke all on function public.cortex_stars_bot_new_order(bigint,text) from public,anon,authenticated;
grant execute on function public.cortex_stars_bot_new_order(bigint,text) to service_role;

create or replace function public.cortex_stars_precheckout(p_id uuid,p_buyer bigint,p_query text,p_stars integer)
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
  -- Existing web-only invoices retain their original behavior. Bot-created or
  -- bot-claimed invoices are payable only by their currently linked Telegram user.
  if item.expected_telegram_id is not null then
    if item.expected_telegram_id <> p_buyer then
      return jsonb_build_object('ok',false,'error','buyer_mismatch');
    end if;
    perform 1 from public.cortex_telegram_account_links l
      join auth.users u on u.id=l.account_id
      where l.account_id=item.subject and l.telegram_id=p_buyer and l.state='linked'
        and u.email_confirmed_at is not null for share of l;
    if not found then return jsonb_build_object('ok',false,'error','link_required'); end if;
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

revoke all on function public.cortex_stars_precheckout(uuid,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.cortex_stars_precheckout(uuid,bigint,text,integer) to service_role;
