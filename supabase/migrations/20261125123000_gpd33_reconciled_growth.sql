begin;
set local lock_timeout='2s';

create table public.gpd33_reconciled_growth (
  snapshot_id uuid primary key,
  environment text not null check(environment in ('test','live')),
  observed_at bigint not null,
  received_at timestamptz not null default clock_timestamp(),
  domain_counts jsonb not null check (jsonb_typeof(domain_counts)='object')
);
alter table public.gpd33_reconciled_growth enable row level security;
revoke all on public.gpd33_reconciled_growth from public,anon,authenticated;
grant select,insert,delete on public.gpd33_reconciled_growth to service_role;

create function public.gpd33_ingest_reconciled_growth(
  snapshot_id uuid,observed_at bigint,environment text,domain_counts jsonb
) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare
  current_seconds bigint:=floor(extract(epoch from now()))::bigint;
  stored record;
  domain_count record;
  invalid_payload constant jsonb:='{"ok":false,"error":"invalid_reconciled_growth_snapshot","status":400}';
  domains constant text[]:=array[
    'consumer_electronics','automotive_parts','home_appliances','fashion','books_media','toys_hobbies',
    'beauty_personal_care','sports_outdoors','home_living','office_business','medical_supplies','food_grocery',
    'baby_kids','pet_supplies','tools_hardware','garden_outdoor','musical_instruments','jewelry_watches',
    'arts_crafts','industrial_supplies','scientific_lab','restaurant_hospitality','safety_security','general_commerce'
  ];
begin
  if snapshot_id is null or observed_at is null or environment not in ('test','live') or environment is null
    or jsonb_typeof(domain_counts) is distinct from 'object' or pg_column_size(domain_counts)>4096 then
    return invalid_payload;
  end if;
  for domain_count in select * from jsonb_each(domain_counts) loop
    if domain_count.key<>all(domains) or jsonb_typeof(domain_count.value) is distinct from 'object' then
      return invalid_payload;
    end if;
    if domain_count.value-array['confirmed_orders','reconciled_invoices']<>'{}'::jsonb
      or jsonb_typeof(domain_count.value->'confirmed_orders') is distinct from 'number'
      or jsonb_typeof(domain_count.value->'reconciled_invoices') is distinct from 'number'
      or (domain_count.value->>'confirmed_orders')!~'^([0-9]|10)$'
      or (domain_count.value->>'reconciled_invoices')!~'^([0-9]|10)$' then
      return invalid_payload;
    end if;
    if (domain_count.value->>'confirmed_orders')::int<(domain_count.value->>'reconciled_invoices')::int then
      return invalid_payload;
    end if;
  end loop;

  -- The lock bounds quota and retention even when the same publisher job retries concurrently.
  perform pg_advisory_xact_lock(17844933,2);
  select s.environment,s.observed_at,s.domain_counts into stored from public.gpd33_reconciled_growth s
    where s.snapshot_id=gpd33_ingest_reconciled_growth.snapshot_id;
  if found then
    if stored.environment is distinct from environment or stored.observed_at is distinct from observed_at
      or stored.domain_counts is distinct from domain_counts then
      return jsonb_build_object('ok',false,'error','reconciled_growth_snapshot_conflict','status',409);
    end if;
    return jsonb_build_object('ok',true,'replayed',true);
  end if;

  if observed_at<current_seconds-86400 or observed_at>current_seconds+300 then
    return jsonb_build_object('ok',false,'error','reconciled_growth_snapshot_not_current','status',409);
  end if;
  if (select count(*) from public.gpd33_reconciled_growth s
    where s.environment=gpd33_ingest_reconciled_growth.environment
      and s.received_at>=date_trunc('day',now(),'UTC'))>=8 then
    return jsonb_build_object('ok',false,'error','reconciled_growth_daily_limit','status',429);
  end if;

  delete from public.gpd33_reconciled_growth s where s.received_at<now()-interval '7 days';
  insert into public.gpd33_reconciled_growth(snapshot_id,observed_at,environment,domain_counts)
    values(snapshot_id,observed_at,environment,domain_counts);
  return jsonb_build_object('ok',true,'replayed',false);
end
$$;

create function public.gpd33_catalog_planning_reconciled() returns jsonb
language sql stable security invoker set search_path='' as $$
  with latest_live as (
    select s.domain_counts,s.observed_at from public.gpd33_reconciled_growth s
    where s.environment='live'
      and s.observed_at between floor(extract(epoch from now()))::bigint-86400
        and floor(extract(epoch from now()))::bigint+300
    order by s.observed_at desc,s.received_at desc,s.snapshot_id
    limit 1
  )
  select public.gpd33_catalog_planning_growth()||jsonb_build_object(
    'reconciled_transaction_signals',coalesce((select domain_counts from latest_live),'{}'::jsonb),
    'reconciled_transaction_observed_at',(select observed_at from latest_live));
$$;

revoke execute on function public.gpd33_ingest_reconciled_growth(uuid,bigint,text,jsonb),
  public.gpd33_catalog_planning_reconciled() from public,anon,authenticated;
grant execute on function public.gpd33_ingest_reconciled_growth(uuid,bigint,text,jsonb),
  public.gpd33_catalog_planning_reconciled() to service_role;
commit;
