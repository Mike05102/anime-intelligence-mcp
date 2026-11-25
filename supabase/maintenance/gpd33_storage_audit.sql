-- Read-only. Payload byte estimates do not allocate shared indexes and page overhead.
-- Relation sizes include indexes and TOAST.
with event_rows as (
  select event_type, occurred_at,
    coalesce(pg_column_size(metadata),0)+coalesce(pg_column_size(endpoint),0)
      +coalesce(pg_column_size(product_id),0)+coalesce(pg_column_size(payer_hash),0)
      +coalesce(pg_column_size(amount_atomic),0)+coalesce(pg_column_size(amount_usdc),0)
      +coalesce(pg_column_size(payment_network),0)+coalesce(pg_column_size(transaction_hash),0)
      +pg_column_size(id)+pg_column_size(event_type)+pg_column_size(occurred_at) as payload_bytes,
    occurred_at<statement_timestamp()-interval '14 days'
      and ((event_type in ('gpd_cron_heartbeat','scheduled_growth_run','discovery_cron_entered',
                            'universal_discovery_attempt','universal_discovery_persist_error',
                            'universal_provisional_catalog_batch','universal_catalog_frontier',
                            'universal_expansion_run'))
        or (event_type='universal_discovery_batch' and endpoint='autonomous_discovery'))
      and product_id is null and payer_hash is null and amount_atomic is null and amount_usdc is null
      and payment_network is null and transaction_hash is null
      and not (metadata ?| array['payment','settlement','transaction_hash','transaction','payer_hash',
        'amount_atomic','amount_usdc','payment_network','order_id','revenue','purchase_attribution'])
      and coalesce(metadata->>'protocol','')<>'x402' as eligible
  from public.api_events
), event_totals as (
  select event_type,count(*) as rows,sum(payload_bytes) as payload_bytes,
    count(*) filter(where eligible) as eligible_rows,
    coalesce(sum(payload_bytes) filter(where eligible),0) as eligible_payload_bytes,
    min(occurred_at) as oldest,max(occurred_at) as newest
  from event_rows group by event_type
), relations as (
  select relname,pg_total_relation_size(oid) as total_bytes,pg_table_size(oid) as table_bytes,
    pg_indexes_size(oid) as index_bytes
  from pg_class where relkind in ('r','m') and relnamespace='public'::regnamespace
  order by total_bytes desc limit 30
)
select jsonb_pretty(jsonb_build_object(
  'database_bytes',pg_database_size(current_database()),
  'bytes_to_gpd_catalog_write_limit',greatest(0,400000000-pg_database_size(current_database())),
  'transaction_read_only',current_setting('transaction_read_only'),
  'events_total_bytes',pg_total_relation_size('public.api_events'::regclass),
  'expired_payload_bytes_estimate',(select coalesce(sum(eligible_payload_bytes),0) from event_totals),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by payload_bytes desc),'[]'::jsonb) from event_totals e),
  'largest_relations',(select coalesce(jsonb_agg(to_jsonb(r) order by total_bytes desc),'[]'::jsonb) from relations r)
)) as gpd33_storage_audit;
