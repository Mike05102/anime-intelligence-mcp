begin;

create function public.gpd33_barcode(value text) returns text
language sql immutable strict parallel safe set search_path = '' as $$
  select case when value ~ '^([0-9]{8}|[0-9]{12,14})$'
    and value !~ '^([0-9])\1+$'
    then case when (select sum(substr(value, n, 1)::integer *
      case when (length(value)-n)%2=0 then 1 else 3 end)
      from generate_series(1,length(value)) n) % 10 = 0
    then lpad(value,14,'0') end end
$$;

create index gpd33_product_barcode on public.products
  (public.gpd33_barcode(jan_code::text)) where jan_code is not null;
create index gpd33_product_legacy_key on public.products
  (public.gpd33_barcode(substring(source_product_key from '^universal:gtin:([0-9]+)$')))
  where source_product_key like 'universal:gtin:%';
create index gpd33_product_metadata_barcode on public.products
  (public.gpd33_barcode(metadata->'identifiers'->>'gtin'))
  where metadata->'identifiers'->>'gtin' is not null;
create index if not exists gpd33_source_product_key on public.products (source_product_key);
create unique index gpd33_verified_key on public.products (source_product_key)
  where metadata->>'gpd33_verified' = 'true';

create index gpd33_refresh_due on public.products (product_type, source_last_checked_at)
  where metadata->>'gpd33_verified'='true';

create table public.gpd33_job (
  singleton boolean primary key default true check(singleton),
  slot bigint not null default -1,
  seen_slot bigint not null default -1,
  owner uuid,
  expires_at timestamptz,
  plan jsonb,
  staged jsonb,
  source_page integer not null default 0,
  catalog_cooldown timestamptz,
  catalog_day date,
  catalog_calls_today integer not null default 0,
  coverage_cache jsonb,
  coverage_at timestamptz
);
insert into public.gpd33_job default values;
alter table public.gpd33_job enable row level security;
revoke all on public.gpd33_job from public, anon, authenticated;
grant select,update on public.gpd33_job to service_role;

create table public.gpd33_runs (
  slot bigint primary key,
  attempted_at timestamptz not null default now(),
  finished_at timestamptz,
  retries int not null default 0,
  failures int not null default 0,
  metrics jsonb,
  abandoned boolean not null default false
);
alter table public.gpd33_runs enable row level security;
revoke all on public.gpd33_runs from public, anon, authenticated;
grant select,insert,update,delete on public.gpd33_runs to service_role;

create function public.gpd33_coverage(domains text[]) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_object_agg(d.domain, jsonb_build_object(
    'canonical', coalesce(c.total,0), 'new_24h', coalesce(c.day_count,0),
    'new_7d', coalesce(c.week_count,0), 'target', 10000,
    'remaining', greatest(10000-coalesce(c.total,0),0),
    'attainment_percent', round(coalesce(c.total,0)/100.0,2),
    'legacy_unverified_rows', coalesce(c.legacy,0)))
  from unnest(domains) d(domain)
  left join (
    select product_type::text as domain,
      count(*) filter(where metadata->>'gpd33_verified'='true') total,
      count(*) filter(where metadata->>'gpd33_verified'='true' and created_at>=now()-interval '1 day') day_count,
      count(*) filter(where metadata->>'gpd33_verified'='true' and created_at>=now()-interval '7 days') week_count,
      count(*) filter(where metadata->>'gpd33_verified' is distinct from 'true') legacy
    from public.products
    where product_type::text=any(domains) and metadata->>'universal_commerce'='true'
      and metadata->>'domain'=product_type::text
      and metadata->>'specialist_intelligence' is distinct from 'true'
    group by product_type
  ) c using(domain)
$$;

create index gpd33_generic_coverage on public.products (product_type, created_at)
  where metadata->>'universal_commerce'='true' and metadata->>'specialist_intelligence' is distinct from 'true';

create function public.gpd33_catalog_batch(rows jsonb, lease uuid default null) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '2s' as $$
declare
  item jsonb;
  prior public.products%rowtype;
  product public.products%rowtype;
  code text;
  owners integer;
  part_alias text;
  inserted integer := 0;
  updated integer := 0;
  duplicate integer := 0;
  rejected integer := 0;
begin
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>40 then
    raise exception 'invalid GPD catalog batch';
  end if;
  if lease is not null and not exists(
    select 1 from public.gpd33_job where singleton and owner=lease and expires_at>clock_timestamp() for update
  ) then raise exception 'GPD discovery lease expired'; end if;
  -- Serialize against legacy writers for the alias lookup and batch transaction.
  lock table public.products in share row exclusive mode;
  for item in select value from jsonb_array_elements(rows) loop
    product := jsonb_populate_record(null::public.products,item);
    code := public.gpd33_barcode(product.metadata->'identifiers'->>'gtin');
    if code is null or product.source_product_key is distinct from 'universal:gtin:'||code
      or product.metadata->>'gpd33_verified' is distinct from 'true'
      or product.metadata->>'universal_commerce' is distinct from 'true'
      or product.metadata->>'domain' is distinct from product.product_type::text
      or product.product_type::text is null
      or product.product_type::text not in ('consumer_electronics','automotive_parts','home_appliances','fashion',
        'books_media','toys_hobbies','beauty_personal_care','sports_outdoors','home_living','office_business',
        'medical_supplies','food_grocery','baby_kids','pet_supplies','tools_hardware','garden_outdoor',
        'musical_instruments','jewelry_watches','arts_crafts','industrial_supplies','scientific_lab',
        'restaurant_hospitality','safety_security','general_commerce')
      or product.metadata->>'evidence_level' not in ('usda_fdc_branded_package','ebay_catalog_product','independent_marketplace_fields')
      or product.metadata->>'evidence_level' is null
      or nullif(product.canonical_name_ja,'') is null then
      rejected := rejected+1;
      continue;
    end if;
    select count(*) into owners from (
      select 1 from public.products p
      where p.source_product_key=product.source_product_key
         or (p.jan_code is not null and public.gpd33_barcode(p.jan_code::text)=code)
         or (p.metadata->'identifiers'->>'gtin' is not null and public.gpd33_barcode(p.metadata->'identifiers'->>'gtin')=code)
         or (p.source_product_key like 'universal:gtin:%' and
             public.gpd33_barcode(substring(p.source_product_key from '^universal:gtin:([0-9]+)$'))=code)
      limit 2
    ) matching;
    if owners=0 then
      part_alias := product.metadata->'identifiers'->>'mpn';
      if part_alias is not null and exists (
        select 1 from public.products p where p.model_number=part_alias
          and upper(trim(p.manufacturer))=upper(trim(product.manufacturer))
          and (p.source_product_key like 'universal:mpn:%' or p.metadata->>'specialist_intelligence'='true')
          and public.gpd33_barcode(p.jan_code::text) is null
      ) then
        duplicate := duplicate+1;
        continue;
      end if;
      insert into public.products (canonical_name_ja,canonical_name_en,manufacturer,jan_code,image_status,
          source_product_key,product_type,product_status,identification_confidence,source_last_checked_at,metadata)
      values (product.canonical_name_ja,product.canonical_name_en,product.manufacturer,product.jan_code,
          product.image_status,product.source_product_key,product.product_type,product.product_status,
          product.identification_confidence,product.source_last_checked_at,product.metadata);
      inserted := inserted+1;
      continue;
    end if;
    duplicate := duplicate+1;
    if owners<>1 then continue; end if;
    select p.* into prior from public.products p
      where p.source_product_key=product.source_product_key
         or (p.jan_code is not null and public.gpd33_barcode(p.jan_code::text)=code)
         or (p.metadata->'identifiers'->>'gtin' is not null and public.gpd33_barcode(p.metadata->'identifiers'->>'gtin')=code)
         or (p.source_product_key like 'universal:gtin:%' and
             public.gpd33_barcode(substring(p.source_product_key from '^universal:gtin:([0-9]+)$'))=code)
      limit 1;
    if prior.metadata->>'universal_commerce' is distinct from 'true'
       or prior.metadata->>'specialist_intelligence' = 'true'
       or prior.metadata->>'domain' is distinct from product.product_type::text
       or prior.product_type is distinct from product.product_type then continue; end if;
    -- Never rewrite a legacy name or identity when reviewing a barcode match.
    if prior.metadata->>'gpd33_verified' is distinct from 'true'
       and (lower(trim(prior.canonical_name_ja)) is distinct from lower(trim(product.canonical_name_ja))
         or lower(trim(prior.manufacturer)) is distinct from lower(trim(product.manufacturer))) then continue; end if;
    if prior.manufacturer is not null and
       upper(trim(prior.manufacturer)) is distinct from upper(trim(product.manufacturer)) then continue; end if;
    if prior.metadata->'gpd33_variant' is not null and product.metadata->'gpd33_variant' is not null
       and prior.metadata->'gpd33_variant' is distinct from product.metadata->'gpd33_variant' then continue; end if;
    if prior.metadata->>'provider'=product.metadata->>'provider'
       and lower(trim(prior.canonical_name_ja)) is distinct from lower(trim(product.canonical_name_ja)) then continue; end if;
    if prior.source_last_checked_at > product.source_last_checked_at then continue; end if;
    update public.products set
      source_last_checked_at=product.source_last_checked_at,
      metadata=coalesce(prior.metadata,'{}'::jsonb)||product.metadata
      where id=prior.id;
    updated := updated+1;
  end loop;
  return jsonb_build_object('new',inserted,'updated',updated,'duplicate',duplicate,'rejected',rejected);
end
$$;

create function public.gpd33_discovery(action text, token uuid, event_slot bigint, payload jsonb default '{}') returns jsonb
language plpgsql set search_path = '' as $$
declare
  j public.gpd33_job%rowtype;
  result jsonb;
begin
  select * into strict j from public.gpd33_job where singleton for update;
  if action='claim' then
    if event_slot<=j.seen_slot or j.expires_at>clock_timestamp() then
      return jsonb_build_object('claimed',false);
    end if;
    if j.plan is not null and exists(select 1 from public.gpd33_runs where slot=j.slot and retries>=2) then
      update public.gpd33_runs set abandoned=true where slot=j.slot;
      j.plan := null;
      j.staged := null;
    end if;
    if j.plan is null then
      update public.gpd33_runs set abandoned=true where slot=j.slot and finished_at is null;
      j.slot := event_slot;
    end if;
    update public.gpd33_job set slot=j.slot,seen_slot=event_slot,plan=j.plan,staged=j.staged,owner=token,expires_at=clock_timestamp()+interval '3 minutes'
      where singleton;
    insert into public.gpd33_runs(slot) values(j.slot)
      on conflict(slot) do update set retries=public.gpd33_runs.retries+1;
    return jsonb_build_object('claimed',true,'slot',j.slot,'plan',j.plan,'staged',j.staged,
      'source_page',j.source_page,'catalog_cooldown',j.catalog_cooldown,
      'coverage',case when j.coverage_at>now()-interval '1 hour' then j.coverage_cache end);
  end if;
  if j.owner is distinct from token or j.expires_at is null or j.expires_at<=clock_timestamp() then
    raise exception 'GPD discovery lease expired';
  end if;
  if action='plan' then
    if j.plan is not null then return j.plan; end if;
    update public.gpd33_job set plan=payload->'plan',
      coverage_cache=coalesce(payload->'coverage',coverage_cache),
      coverage_at=case when payload ? 'coverage' then now() else coverage_at end
      where singleton;
    update public.gpd33_runs set metrics=jsonb_build_object('domain',payload->'plan'->>'domain') where slot=j.slot;
    return payload->'plan';
  elsif action='reserve_catalog' then
    if j.catalog_cooldown>now() or
       (j.catalog_day=(now() at time zone 'UTC')::date and j.catalog_calls_today>=20) then
      return '{"allowed":false}';
    end if;
    update public.gpd33_job set
      catalog_day=(now() at time zone 'UTC')::date,
      catalog_calls_today=case when catalog_day=(now() at time zone 'UTC')::date then catalog_calls_today+1 else 1 end
      where singleton;
    return '{"allowed":true}';
  elsif action='catalog_limited' then
    update public.gpd33_job set catalog_cooldown=now()+interval '24 hours' where singleton;
    return '{"recorded":true}';
  elsif action='stage' then
    if j.plan is null or jsonb_typeof(payload->'rows') is distinct from 'array'
        or jsonb_array_length(payload->'rows')>40 then raise exception 'invalid staged batch'; end if;
    if j.staged is null then update public.gpd33_job set staged=payload where singleton; end if;
    return '{"staged":true}';
  elsif action='commit' then
    if j.staged is null then raise exception 'no staged batch'; end if;
    result := public.gpd33_catalog_batch(j.staged->'rows',token);
    update public.gpd33_runs set finished_at=clock_timestamp(), metrics=(j.staged->'metrics')||result||jsonb_build_object('domain',j.plan->>'domain') where slot=j.slot;
    update public.gpd33_job set plan=null,staged=null,owner=null,expires_at=null,
      source_page=case when j.staged->>'catalog_advance'='true' then source_page+1 else source_page end,
      catalog_cooldown=case when j.staged->>'catalog_limited'='true' then now()+interval '24 hours' else catalog_cooldown end
      where singleton;
    if event_slot%24=0 then
      delete from public.gpd33_runs
        where slot in (select slot from public.gpd33_runs where attempted_at<now()-interval '30 days' order by slot limit 288);
      delete from public.api_events e where e.ctid in (
        select ctid from public.api_events
        where occurred_at<now()-interval '14 days' and metadata->>'version'='33.0.0'
          and (event_type in ('universal_discovery_attempt','universal_provisional_catalog_batch','universal_catalog_frontier','universal_expansion_run')
            or (event_type='universal_discovery_batch' and metadata->>'exploration_source'='scheduled_catalog')
            or (event_type='universal_product_snapshot' and metadata->>'gpd33_scheduled'='true'))
        order by occurred_at limit 400
      );
    end if;
    return result;
  elsif action='failed' then
    update public.gpd33_runs set failures=failures+1 where slot=j.slot;
    update public.gpd33_job set owner=null,expires_at=null where singleton;
    return '{"released":true}';
  end if;
  raise exception 'unknown GPD discovery action';
end
$$;

create function public.gpd33_run_metrics() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'scheduled_slots_expected_24h',144,
    'jobs_started_24h', count(*) filter(where attempted_at>=now()-interval '1 day'),
    'jobs_completed_24h',count(*) filter(where finished_at>=now()-interval '1 day'),
    'jobs_pending_24h',count(*) filter(where attempted_at>=now()-interval '1 day' and finished_at is null and not abandoned),
    'jobs_abandoned_24h',count(*) filter(where attempted_at>=now()-interval '1 day' and abandoned),
    'jobs_completion_rate_24h', count(*) filter(where attempted_at>=now()-interval '1 day' and finished_at is not null)::numeric
      /nullif(count(*) filter(where attempted_at>=now()-interval '1 day'),0),
    'cpu_failures_24h',null,
    'jobs_failure_rate_24h',count(*) filter(where attempted_at>=now()-interval '1 day' and (failures>0 or abandoned))::numeric
      /nullif(count(*) filter(where attempted_at>=now()-interval '1 day'),0),
    'marketplace_7d',jsonb_build_object(
      'ebay_calls',coalesce(sum((metrics->>'ebay_calls')::int) filter(where finished_at>=now()-interval '7 days'),0),
      'yahoo_calls',coalesce(sum((metrics->>'yahoo_calls')::int) filter(where finished_at>=now()-interval '7 days'),0),
      'catalog_fallback_calls',coalesce(sum((metrics->>'catalog_calls')::int) filter(where finished_at>=now()-interval '7 days'),0),
      'catalog_fallback_errors',coalesce(sum((metrics->>'catalog_errors')::int) filter(where finished_at>=now()-interval '7 days'),0)),
    'failures_reported_24h',coalesce(sum(failures) filter(where attempted_at>=now()-interval '1 day'),0),
    'retries_24h',coalesce(sum(retries) filter(where attempted_at>=now()-interval '1 day'),0),
    'providers_7d',coalesce((
      select jsonb_object_agg(provider, stats) from (
        select metrics->>'provider' provider, jsonb_build_object(
          'runs',count(*),'provider_calls',sum((metrics->>'calls')::int),
          'provider_errors',sum((metrics->>'provider_errors')::int),
          'candidates',sum((metrics->>'candidates')::int),'identified',sum((metrics->>'identified')::int),
          'new',sum((metrics->>'new')::int),'duplicate',sum((metrics->>'duplicate')::int),
          'identification_rate',sum((metrics->>'identified')::int)::numeric/nullif(sum((metrics->>'candidates')::int),0),
          'conversion_rate',sum((metrics->>'new')::int)::numeric/nullif(sum((metrics->>'candidates')::int),0),
          'duplicate_rate',sum((metrics->>'duplicate')::int)::numeric/nullif(sum((metrics->>'identified')::int),0)
        ) stats from public.gpd33_runs where finished_at>=now()-interval '7 days' and metrics ? 'provider'
        group by metrics->>'provider'
      ) grouped
    ),'{}'::jsonb),
    'storage',jsonb_build_object('database_bytes',pg_database_size(current_database()),
      'products_bytes',pg_table_size('public.products'::regclass),'products_index_bytes',pg_indexes_size('public.products'::regclass),
      'events_bytes',pg_total_relation_size('public.api_events'::regclass),
      'products_rows_estimate',greatest(0,(select reltuples::bigint from pg_class where oid='public.products'::regclass)))
  )
  from public.gpd33_runs
$$;

revoke execute on function public.gpd33_coverage(text[]), public.gpd33_catalog_batch(jsonb,uuid),
  public.gpd33_discovery(text,uuid,bigint,jsonb), public.gpd33_run_metrics() from public,anon,authenticated;
grant execute on function public.gpd33_coverage(text[]), public.gpd33_catalog_batch(jsonb,uuid),
  public.gpd33_discovery(text,uuid,bigint,jsonb), public.gpd33_run_metrics() to service_role;

commit;
