begin;
set local lock_timeout = '2s';

create function public.gpd33_catalog_planning() returns jsonb
language sql stable security invoker set search_path='' as $$
  with recent as materialized (
    select metrics->>'domain' as domain, metrics->>'query_family' as family, finished_at,
      (metrics->>'new')::int as new_count, (metrics->>'calls')::int as provider_calls
    from public.gpd33_runs
    where finished_at>=now()-interval '7 days'
      and metrics ? 'domain' and metrics ? 'new'
  ), per_domain as (
    select domain,jsonb_build_object('runs',count(*),'new',sum(new_count)) as summary
    from recent
    group by domain
  ), per_query as (
    select domain,family,count(*) as runs,sum(new_count) as new_count,
      sum(provider_calls) as provider_calls,max(finished_at) as last_at
    from recent
    where length(family) between 1 and 180
    group by domain,family
  ), recent_queries as (
    select domain,family,runs,new_count,provider_calls,last_at,
      row_number() over (partition by domain order by last_at desc,family) as row_number
    from per_query
  ), query_summary as (
    select domain,jsonb_object_agg(family,jsonb_build_object(
      'runs',runs,'new',new_count,'calls',provider_calls,'last_at',last_at)) as summary
    from recent_queries
    where row_number<=4
    group by domain
  )
  select jsonb_build_object(
    'efficiency',coalesce((select jsonb_object_agg(domain,summary) from per_domain),'{}'::jsonb),
    'queries',coalesce((select jsonb_object_agg(domain,summary) from query_summary),'{}'::jsonb)
  );
$$;

revoke execute on function public.gpd33_catalog_planning() from public,anon,authenticated;
grant execute on function public.gpd33_catalog_planning() to service_role;
commit;
