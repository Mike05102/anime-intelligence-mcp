-- Read-only. SYSTEM samples physical heap pages and does not return event payloads.
-- Neither tuple bytes nor sampled counts determine retained physical size.
with sampled as (
  select e.event_type, pg_column_size(e) as tuple_bytes
  from public.api_events e tablesample system (1) repeatable (46)
), grouped as (
  select event_type, count(*) as rows, sum(tuple_bytes) as tuple_bytes
  from sampled group by event_type order by tuple_bytes desc limit 12
)
select statement_timestamp() as observed_at,
       (select count(*) from sampled) as sample_rows,
       (select sum(tuple_bytes) from sampled) as sample_tuple_bytes,
       (select jsonb_agg(to_jsonb(g) order by g.tuple_bytes desc) from grouped g) as largest_types,
       (select jsonb_build_object('rows',count(*),
          'tuple_bytes',coalesce(sum(pg_column_size(e)),0),
          'metadata_bytes',coalesce(sum(pg_column_size(e.metadata)),0))
        from public.api_events e where e.event_type in (
          'paid_call','payment_attempt','payment_verified','payment_retry_received',
          'payment_settlement_failed','payment_verify_failed','x402_failed'
        )) as checkpoint_payment_categories;
