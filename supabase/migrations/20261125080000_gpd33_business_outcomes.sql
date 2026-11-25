begin;
set local lock_timeout='2s';

-- Record-derived telemetry. A settlement record has not been reconciled here
-- against the chain, and a merchant event is not a verified order.
create function public.gpd33_business_outcomes() returns jsonb
language sql stable security invoker set search_path='' as $$
  with time_window as (
    select now()-interval '30 days' as since,now() as until
  ), activity as materialized (
    select e.event_type,e.payment_network,e.transaction_hash,e.amount_usdc
    from public.api_events e cross join time_window w
    where e.occurred_at>=w.since and e.occurred_at<=w.until
      and e.event_type in ('universal_purchase_decision_served','purchase_intent_created',
        'purchase_url_served','merchant_selected','checkout_started','purchase_confirmed',
        'payment_attempt','payment_settlement_failed','paid_call')
  ), receipts as (
    select payment_network,transaction_hash,count(*) as records,
      count(distinct amount_usdc)=1 and bool_and(coalesce(amount_usdc>0,false)) as consistent,
      min(amount_usdc) as amount_usdc
    from activity
    where event_type='paid_call' and nullif(btrim(payment_network),'') is not null
      and nullif(btrim(transaction_hash),'') is not null
    group by payment_network,transaction_hash
  )
  select jsonb_build_object(
    'window_days',30,'window_start',(select since from time_window),'as_of',(select until from time_window),
    'recorded_events',jsonb_build_object(
      'purchase_decisions',(select count(*) from activity where event_type='universal_purchase_decision_served'),
      'purchase_intents',(select count(*) from activity where event_type='purchase_intent_created'),
      'merchant_selections',(select count(*) from activity where event_type='merchant_selected'),
      'purchase_links_served',(select count(*) from activity where event_type='purchase_url_served'),
      'checkout_started',(select count(*) from activity where event_type='checkout_started'),
      'purchase_confirmation_events',(select count(*) from activity where event_type='purchase_confirmed'),
      'payment_attempt_events',(select count(*) from activity where event_type='payment_attempt'),
      'settlement_failure_events',(select count(*) from activity where event_type='payment_settlement_failed')
    ),
    'settlement_telemetry',jsonb_build_object(
      'scope','retained_database_events_including_test_traffic',
      'paid_call_records',(select count(*) from activity where event_type='paid_call'),
      'distinct_consistent_receipts',(select count(*) from receipts where consistent),
      'duplicate_receipt_records',(select coalesce(sum(records-1),0) from receipts),
      'inconsistent_receipts',(select count(*) from receipts where not consistent),
      'records_without_receipt_identifier',(select count(*) from activity where event_type='paid_call'
        and (nullif(btrim(payment_network),'') is null or nullif(btrim(transaction_hash),'') is null)),
      'recorded_receipt_usdc',(select coalesce(sum(amount_usdc),0) from receipts where consistent)
    ),
    'verified_outcomes',jsonb_build_object(
      'active_ai_agents',null,'merchant_accepted_handoffs',null,'confirmed_goods_transactions',null,
      'reconciled_external_revenue_usdc',null,'payment_success_rate',null,'profit',null)
  )
$$;
revoke execute on function public.gpd33_business_outcomes() from public,anon,authenticated;
grant execute on function public.gpd33_business_outcomes() to service_role;
commit;
