create or replace function gpd33_maintenance.compact_ingress(batch_size int) returns int
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare
  removed int;
  rolled bigint;
begin
  if batch_size is null or batch_size not between 1 and 5000 then
    raise exception 'invalid telemetry batch size';
  end if;
  if not pg_try_advisory_xact_lock(173302,2) then return 0; end if;

  with protected_requests as materialized (
    select distinct metadata->>'request_id' as request_id from public.api_events
    where event_type in ('payment_retry_received','payment_attempt','payment_verified','paid_call',
                         'payment_verify_failed','payment_settlement_failed','x402_failed','x402_refund')
      and nullif(metadata->>'request_id','') is not null
  ), candidates as materialized (
    select e.id from public.api_events e
    where e.event_type in ('api_call','x402_gate_entered','payment_required','payment_challenge_issued')
      and e.occurred_at<statement_timestamp()-interval '14 days'
      and gpd33_maintenance.is_bare_ingress(e)
      and not exists (select 1 from protected_requests p where p.request_id=e.metadata->>'request_id')
    order by e.occurred_at,e.id limit batch_size for update skip locked
  ), deleted as (
    delete from public.api_events e using candidates c where e.id=c.id
    returning e.occurred_at,e.event_type,e.endpoint,e.metadata,e.amount_atomic,e.payment_network
  ), counts as (
    insert into gpd33_maintenance.ingress_daily as totals
    select (occurred_at at time zone 'UTC')::date,event_type,coalesce(endpoint,''),
      coalesce(metadata->>'source_class',''),coalesce(metadata->>'version',''),
      coalesce(amount_atomic,-1),coalesce(payment_network,''),count(*)
    from deleted group by 1,2,3,4,5,6,7
    on conflict(day,event_type,endpoint,source_class,version,quoted_atomic,network)
    do update set events=totals.events+excluded.events
    returning 1
  )
  select (select count(*) from deleted),(select count(*) from counts) into removed,rolled;
  if removed>0 and rolled=0 then raise exception 'telemetry rollup failed'; end if;
  return removed;
end
$$;
