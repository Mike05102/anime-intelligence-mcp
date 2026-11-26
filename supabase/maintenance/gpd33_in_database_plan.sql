-- Read-only estimate for operating entirely in PostgreSQL.
-- Return only aggregate counts and approximate payload bytes for a seven-day
-- window. Change window_start to audit another UTC week without a full scan.
with parameters as (
  select date_trunc('week',now()-interval '28 days','UTC') as window_start
), payment_requests as materialized (
  select distinct metadata->>'request_id' as request_id
  from public.api_events
  where event_type in ('payment_retry_received','payment_attempt','payment_verified','paid_call',
                       'payment_verify_failed','payment_settlement_failed','x402_failed','x402_refund')
    and nullif(metadata->>'request_id','') is not null
), latest_state as materialized (
  select s.id from (values ('dynamic_catalog_pool'),('catalog_seed_progress')) k(event_type)
  cross join lateral (
    select e.id from public.api_events e where e.event_type=k.event_type
    order by e.occurred_at desc,e.id desc limit 2
  ) s
), assessed as (
  select e.event_type, coalesce(pg_column_size(e.metadata),0) as metadata_bytes,
    case
      when e.occurred_at<statement_timestamp()-interval '14 days'
        and e.event_type in ('api_call','x402_gate_entered','payment_required','payment_challenge_issued')
        and e.metadata->>'method' in ('GET','HEAD')
        and e.metadata->'payment_header_present'='false'::jsonb
        and e.metadata->'query_present'='false'::jsonb
        and e.metadata->'id_present'='false'::jsonb
        and not (e.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash',
          'order_id','revenue','purchase_attribution'])
        and nullif(e.metadata->>'intent_query','') is null
        and nullif(e.metadata->>'intent_id','') is null
        and nullif(e.metadata->>'query_text','') is null
        and e.product_id is null and e.payer_hash is null and e.transaction_hash is null
        and (e.event_type not in ('payment_required','payment_challenge_issued')
          or e.metadata->>'response_status'='402')
        and not exists(select 1 from payment_requests p where p.request_id=e.metadata->>'request_id')
        then 'daily_rollup'
      when e.product_id is null and e.payer_hash is null and e.transaction_hash is null
        and e.amount_atomic is null and e.amount_usdc is null and e.payment_network is null
        and not (e.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash',
          'amount_atomic','amount_usdc','payment_network','order_id','revenue','purchase_attribution'])
        and coalesce(e.metadata->>'protocol','')<>'x402'
        and (
          (e.occurred_at<statement_timestamp()-interval '14 days' and
            (e.event_type in ('gpd_cron_heartbeat','scheduled_growth_run','discovery_cron_entered',
              'universal_discovery_attempt','universal_discovery_persist_error','universal_provisional_catalog_batch',
              'universal_catalog_frontier','universal_expansion_run')
              or (e.event_type='universal_discovery_batch' and e.endpoint='autonomous_discovery')
              or (e.event_type in ('dynamic_catalog_pool','catalog_seed_progress')
                and not exists(select 1 from latest_state s where s.id=e.id))))
          or (e.occurred_at<statement_timestamp()-interval '1 day' and
            e.event_type in ('gpd_cron_heartbeat','discovery_cron_entered','scheduled_growth_run')
            and coalesce(e.metadata->>'ok','true')<>'false' and not (e.metadata ? 'error')
            and coalesce(e.metadata->'errors','[]'::jsonb)='[]'::jsonb)
          or (e.occurred_at<statement_timestamp()-interval '7 days' and
            (e.event_type in ('universal_discovery_persist_error','identity_preflight_failed','x402_configuration_error')
              or (e.event_type='universal_discovery_attempt' and e.metadata->>'phase'='failed')
              or (e.event_type='scheduled_growth_run' and
                (e.metadata->>'ok'='false' or e.metadata ? 'error'
                or coalesce(e.metadata->'errors','[]'::jsonb)<>'[]'::jsonb))))
        ) then 'expired_diagnostics'
      else 'retain'
    end as action
  from public.api_events e cross join parameters p
  where e.occurred_at>=p.window_start and e.occurred_at<p.window_start+interval '7 days'
)
select action,count(*) as rows,coalesce(sum(metadata_bytes),0) as metadata_bytes,
 count(*) filter(where event_type in ('paid_call','payment_verified','payment_attempt',
   'payment_retry_received','payment_settlement_failed')) as payment_audit_rows
from assessed group by action order by action;
