begin;
set local lock_timeout='2s';

create table gpd33_maintenance.ingress_daily (
  day date not null,
  event_type text not null,
  endpoint text not null,
  source_class text not null,
  version text not null,
  quoted_atomic bigint not null,
  network text not null,
  events bigint not null check (events>0),
  primary key(day,event_type,endpoint,source_class,version,quoted_atomic,network)
);
alter table gpd33_maintenance.ingress_daily enable row level security;
revoke all on gpd33_maintenance.ingress_daily from public,anon,authenticated;
grant select on gpd33_maintenance.ingress_daily to service_role;
create policy ingress_daily_service_read on gpd33_maintenance.ingress_daily
  for select to service_role using (true);

-- A numeric amount on a 402 offer is a quote. A transaction or payer
-- anywhere on the record is grounds to retain the full record.
create function gpd33_maintenance.is_bare_ingress(e public.api_events) returns boolean
language sql stable set search_path='' as $$
  select e.event_type in ('api_call','x402_gate_entered','payment_required','payment_challenge_issued')
    and e.metadata->>'method' in ('GET','HEAD')
    and e.metadata->'payment_header_present'='false'::jsonb
    and e.metadata->'query_present'='false'::jsonb
    and e.metadata->'id_present'='false'::jsonb
    and not (e.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash','order_id','revenue','purchase_attribution'])
    and nullif(e.metadata->>'intent_query','') is null
    and nullif(e.metadata->>'intent_id','') is null
    and nullif(e.metadata->>'query_text','') is null
    and e.product_id is null and e.payer_hash is null and e.transaction_hash is null
    and (e.event_type not in ('payment_required','payment_challenge_issued')
      or e.metadata->>'response_status'='402')
$$;

create function gpd33_maintenance.compact_ingress(batch_size int) returns int
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
                         'payment_verify_failed','payment_settlement_failed','x402_failed')
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

create function public.gpd33_ingress_rollup(take int default 100) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
    select day,event_type,sum(events) as events from gpd33_maintenance.ingress_daily
    group by day,event_type order by day desc,event_type limit greatest(1,least(400,take))
  ) r
$$;

create function gpd33_maintenance.prune_superseded_state(batch_size int) returns int
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare removed int;
begin
  if batch_size is null or batch_size not between 1 and 5000 then
    raise exception 'invalid state retention batch size';
  end if;
  if not pg_try_advisory_xact_lock(173302,3) then return 0; end if;
  with latest as materialized (
    select x.id from (values ('dynamic_catalog_pool'),('catalog_seed_progress')) k(event_type)
    cross join lateral (
      select a.id from public.api_events a where a.event_type=k.event_type
      order by a.occurred_at desc,a.id desc limit 2
    ) x
  ), expired as (
    select e.id from public.api_events e
    where e.event_type in ('dynamic_catalog_pool','catalog_seed_progress')
      and e.occurred_at<statement_timestamp()-interval '14 days'
      and e.product_id is null and e.payer_hash is null and e.amount_atomic is null and e.amount_usdc is null
      and e.transaction_hash is null and e.payment_network is null
      and not (e.metadata ?| array['payment','settlement','transaction_hash','order_id','revenue'])
      and not exists (select 1 from latest l where l.id=e.id)
    order by e.occurred_at,e.id limit batch_size for update skip locked
  )
  delete from public.api_events a using expired x where a.id=x.id;
  get diagnostics removed=row_count;
  return removed;
end
$$;

create or replace function public.gpd33_prune_events() returns integer
language sql security invoker set search_path='' as $$
  select gpd33_maintenance.prune_events(1500)+gpd33_maintenance.compact_ingress(5000)
    +gpd33_maintenance.prune_superseded_state(1500)
$$;
revoke execute on function gpd33_maintenance.is_bare_ingress(public.api_events),
  gpd33_maintenance.compact_ingress(int),gpd33_maintenance.prune_superseded_state(int),public.gpd33_ingress_rollup(int) from public,anon,authenticated;
grant execute on function gpd33_maintenance.compact_ingress(int),gpd33_maintenance.prune_superseded_state(int),public.gpd33_ingress_rollup(int) to service_role;
commit;
