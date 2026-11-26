-- Read-only. Quote logging does not imply a payment. Rows lacking the
-- request flags required by the compaction policy are preserved.
with protected_requests as materialized (
  select distinct metadata->>'request_id' as request_id from public.api_events
  where event_type in ('payment_retry_received','payment_attempt','payment_verified','paid_call',
                       'payment_verify_failed','payment_settlement_failed','x402_failed','x402_refund')
    and nullif(metadata->>'request_id','') is not null
)
select e.event_type,count(*) as candidate_rows,
  sum(pg_column_size(e.metadata)) as candidate_metadata_bytes
from public.api_events e
where e.event_type in ('api_call','x402_gate_entered','payment_required','payment_challenge_issued')
  and e.occurred_at<statement_timestamp()-interval '14 days'
  and e.metadata->>'method' in ('GET','HEAD')
  and e.metadata->'payment_header_present'='false'::jsonb
  and e.metadata->'query_present'='false'::jsonb
  and e.metadata->'id_present'='false'::jsonb
  and not (e.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash','order_id','revenue','purchase_attribution'])
  and nullif(e.metadata->>'intent_query','') is null
  and nullif(e.metadata->>'intent_id','') is null
  and nullif(e.metadata->>'query_text','') is null
  and e.product_id is null and e.payer_hash is null and e.transaction_hash is null
  and (e.event_type not in ('payment_required','payment_challenge_issued') or e.metadata->>'response_status'='402')
  and not exists (select 1 from protected_requests p where p.request_id=e.metadata->>'request_id')
group by e.event_type order by candidate_metadata_bytes desc;
