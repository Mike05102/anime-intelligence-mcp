begin;
set local lock_timeout='2s';

create function public.gpd33_health_events() returns jsonb
language sql stable security invoker set search_path='' as $$
  with kinds(event_type) as (
    values ('gpd_cron_heartbeat'),('discovery_cron_entered'),('universal_discovery_attempt'),
      ('universal_expansion_run'),('universal_discovery_batch'),('universal_provisional_catalog_batch'),
      ('universal_discovery_persist_error'),('scheduled_growth_run')
  ), samples as materialized (
    select k.event_type,r.occurred_at,r.metadata
    from kinds k left join lateral (
      select e.occurred_at,case when k.event_type in ('universal_discovery_attempt','universal_expansion_run')
        then e.metadata end as metadata
      from public.api_events e where e.event_type=k.event_type
      order by e.occurred_at desc limit 30
    ) r on true
  ), per_type as (
    select event_type,jsonb_build_object('read_ok',true,'recent_rows',count(occurred_at),'latest_at',max(occurred_at))
      || case when event_type='universal_discovery_attempt' then jsonb_build_object('recent_phases',jsonb_build_object(
        'started',count(*) filter(where metadata->>'phase'='started'),
        'completed',count(*) filter(where metadata->>'phase'='completed'),
        'failed',count(*) filter(where metadata->>'phase'='failed'))) else '{}'::jsonb end as value
    from samples group by event_type
  ), expansion as materialized (
    select e.metadata->'refreshed' as refreshed from public.api_events e
    where e.event_type='universal_expansion_run' and e.occurred_at>=now()-interval '24 hours'
    order by e.occurred_at desc limit 150
  ), domains as (
    select coalesce(item->>'domain','unknown') domain,
      sum(case when item->>'canonical_new' ~ '^[0-9]{1,9}$' then (item->>'canonical_new')::int else 0 end) canonical_new
    from expansion x cross join lateral jsonb_array_elements(
      case when jsonb_typeof(x.refreshed)='array' then x.refreshed else '[]'::jsonb end
    ) as detail(item) group by 1
  )
  select jsonb_build_object(
    'events',(select jsonb_object_agg(event_type,value) from per_type),
    'latest_completed',(select jsonb_build_object('at',occurred_at,'metadata',metadata) from samples
      where event_type='universal_discovery_attempt' and metadata->>'phase'='completed'
      order by occurred_at desc limit 1),
    'latest_expansion',(select jsonb_build_object('at',occurred_at,'metadata',metadata) from samples
      where event_type='universal_expansion_run' and occurred_at is not null order by occurred_at desc limit 1),
    'growth_24h',jsonb_build_object('read_ok',true,'completed_expansion_events',(select count(*) from expansion),
      'expected_cron_slots',144,'reported_canonical_new',(select coalesce(sum(canonical_new),0) from domains),
      'by_domain',(select coalesce(jsonb_object_agg(domain,canonical_new),'{}'::jsonb) from domains),
      'possibly_truncated',(select count(*)>=150 from expansion),'source','expansion_events_not_database_count')
  )
$$;
create function public.gpd33_coverage_events() returns jsonb
language sql stable security invoker set search_path='' as $$
  with sample as materialized (
    (select event_type,metadata from public.api_events
      where event_type='universal_product_demand' and occurred_at>=now()-interval '7 days'
      order by occurred_at desc limit 200)
    union all
    (select event_type,metadata from public.api_events
      where event_type='universal_product_snapshot' and occurred_at>=now()-interval '24 hours'
      order by occurred_at desc limit 200)
  ), by_domain as (
    select coalesce(metadata->>'domain','general_commerce') domain,
      count(*) filter(where event_type='universal_product_demand') demands_7d,
      count(*) filter(where event_type='universal_product_snapshot') snapshots_24h,
      coalesce(sum(case when event_type='universal_product_snapshot' and jsonb_typeof(metadata->'offers')='array'
        then jsonb_array_length(metadata->'offers') else 0 end),0) offers_24h
    from sample group by 1
  ), providers as (
    select distinct item->>'provider' as provider from sample s
    cross join lateral jsonb_array_elements(case when s.event_type='universal_product_snapshot'
      and jsonb_typeof(s.metadata->'offers')='array' then s.metadata->'offers' else '[]'::jsonb end) detail(item)
    where nullif(item->>'provider','') is not null
  )
  select jsonb_build_object(
    'domain_metrics',(select coalesce(jsonb_object_agg(domain,to_jsonb(d)-'domain'),'{}'::jsonb) from by_domain d),
    'market_providers_observed',(select coalesce(jsonb_agg(provider order by provider),'[]'::jsonb) from providers),
    'identity_keys_observed_24h',(select count(distinct nullif(metadata->>'identity_key','')) from sample
      where event_type='universal_product_snapshot'),
    'offers_observed_24h',(select coalesce(sum(offers_24h),0) from by_domain)
  )
$$;
revoke execute on function public.gpd33_health_events(),public.gpd33_coverage_events() from public,anon,authenticated;
grant execute on function public.gpd33_health_events(),public.gpd33_coverage_events() to service_role;
commit;
