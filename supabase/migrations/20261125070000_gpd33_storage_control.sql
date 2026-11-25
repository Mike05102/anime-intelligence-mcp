begin;
set local lock_timeout='2s';

create table gpd33_maintenance.storage_sample (
  singleton bool primary key default true check(singleton),
  database_bytes bigint not null,
  measured_at timestamptz not null
);
alter table gpd33_maintenance.storage_sample enable row level security;

create function gpd33_maintenance.capture_ingress() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- These four stages report traffic or quoted terms. Signing, verification,
  -- settlement and replay records continue to use their own event types.
  if new.event_type in ('api_call','x402_gate_entered','payment_required','payment_challenge_issued')
    and new.metadata->'payment_header_present'='false'::jsonb
    and new.payer_hash is null and new.transaction_hash is null
    and not (new.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash','order_id','revenue','purchase_attribution'])
    and (new.event_type not in ('payment_required','payment_challenge_issued')
      or new.metadata->>'response_status'='402')
  then
    insert into gpd33_maintenance.ingress_daily as d
      (day,event_type,endpoint,source_class,version,quoted_atomic,network,events)
      values ((new.occurred_at at time zone 'UTC')::date,new.event_type,'','','',-1,'',1)
      on conflict(day,event_type,endpoint,source_class,version,quoted_atomic,network)
      do update set events=d.events+1;
    return null;
  end if;
  -- At pressure, retain all payments, product records and errors.
  if new.event_type in ('gpd_cron_heartbeat','discovery_cron_entered','scheduled_growth_run',
                        'universal_discovery_attempt','universal_expansion_run','universal_catalog_frontier',
                        'universal_provisional_catalog_batch')
    and new.product_id is null and new.payer_hash is null and new.transaction_hash is null
    and new.amount_atomic is null and new.amount_usdc is null and new.payment_network is null
    and not (new.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash','order_id','revenue','purchase_attribution','error'])
    and coalesce(new.metadata->>'phase','')<>'failed'
    and coalesce(new.metadata->>'ok','true')<>'false'
    and exists(select 1 from gpd33_maintenance.storage_sample s where s.singleton and s.database_bytes>=450000000)
  then return null; end if;
  return new;
end
$$;
revoke execute on function gpd33_maintenance.capture_ingress() from public,anon,authenticated;
create trigger gpd33_capture_ingress before insert on public.api_events
  for each row execute function gpd33_maintenance.capture_ingress();

create function gpd33_maintenance.prune_operational_events(batch_size int) returns int
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare removed int;
begin
  if batch_size is null or batch_size not between 1 and 5000 then raise exception 'invalid retention batch'; end if;
  if not pg_try_advisory_xact_lock(173302,4) then return 0; end if;
  with expired as (
    select e.id from public.api_events e
    where e.occurred_at<statement_timestamp()-interval '1 day'
      and (
        (e.event_type in ('gpd_cron_heartbeat','discovery_cron_entered','scheduled_growth_run')
          and coalesce(e.metadata->>'ok','true')<>'false' and not (e.metadata ? 'error')
          and coalesce(e.metadata->'errors','[]'::jsonb)='[]'::jsonb)
        or (e.occurred_at<statement_timestamp()-interval '7 days'
          and (e.event_type in ('universal_discovery_persist_error','identity_preflight_failed','x402_configuration_error')
            or (e.event_type='universal_discovery_attempt' and e.metadata->>'phase'='failed')
            or (e.event_type='scheduled_growth_run' and
              (e.metadata->>'ok'='false' or e.metadata ? 'error' or coalesce(e.metadata->'errors','[]'::jsonb)<>'[]'::jsonb))))
      )
      and e.product_id is null and e.payer_hash is null and e.amount_atomic is null and e.amount_usdc is null
      and e.transaction_hash is null and e.payment_network is null
      and not (e.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash','order_id','revenue','purchase_attribution'])
    order by e.occurred_at,e.id limit batch_size for update skip locked
  )
  delete from public.api_events e using expired x where e.id=x.id;
  get diagnostics removed=row_count;
  return removed;
end
$$;

create function gpd33_maintenance.refresh_storage_sample() returns jsonb
language plpgsql security definer set search_path='' as $$
declare bytes bigint := pg_database_size(current_database());
begin
  insert into gpd33_maintenance.storage_sample(singleton,database_bytes,measured_at)
  values (true,bytes,statement_timestamp()) on conflict(singleton)
  do update set database_bytes=excluded.database_bytes,measured_at=excluded.measured_at;
  return jsonb_build_object('database_bytes',bytes,'target_bytes',400000000,'free_quota_bytes',500000000,
    'catalog_paused',bytes>=400000000,'nonessential_diagnostics_paused',bytes>=450000000);
end
$$;
create function public.gpd33_storage_status() returns jsonb
language sql security invoker set search_path='' as $$
  select gpd33_maintenance.refresh_storage_sample()
$$;
create or replace function public.gpd33_prune_events() returns int
language sql security invoker set search_path='' as $$
  select gpd33_maintenance.prune_events(1500)+gpd33_maintenance.compact_ingress(5000)
    +gpd33_maintenance.prune_superseded_state(1500)+gpd33_maintenance.prune_operational_events(3000)
$$;
revoke execute on function gpd33_maintenance.prune_operational_events(int),
  gpd33_maintenance.refresh_storage_sample(),public.gpd33_storage_status() from public,anon,authenticated;
grant execute on function gpd33_maintenance.prune_operational_events(int),
  gpd33_maintenance.refresh_storage_sample(),public.gpd33_storage_status() to service_role;
commit;
