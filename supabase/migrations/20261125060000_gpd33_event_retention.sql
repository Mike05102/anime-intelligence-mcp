begin;
set local lock_timeout = '2s';

create schema gpd33_maintenance;
revoke all on schema gpd33_maintenance from public, anon, authenticated;
grant usage on schema gpd33_maintenance to service_role;

-- The private function permits only a bounded deletion under a fixed policy.
-- No direct DELETE privilege on api_events is needed by the Worker.
create function gpd33_maintenance.prune_events(batch_size integer) returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare
  removed integer;
begin
  if batch_size is null or batch_size not between 1 and 5000 then
    raise exception 'invalid event retention batch size';
  end if;
  if not pg_try_advisory_xact_lock(173302, 1) then return 0; end if;

  with expired as materialized (
    select id
    from public.api_events
    where occurred_at<statement_timestamp()-interval '14 days'
      and ((event_type in ('gpd_cron_heartbeat','scheduled_growth_run','discovery_cron_entered',
                            'universal_discovery_attempt','universal_discovery_persist_error',
                            'universal_provisional_catalog_batch','universal_catalog_frontier',
                            'universal_expansion_run'))
        or (event_type='universal_discovery_batch' and endpoint='autonomous_discovery'))
      and product_id is null and payer_hash is null and amount_atomic is null and amount_usdc is null
      and payment_network is null and transaction_hash is null
      and not (metadata ?| array['payment','settlement','transaction_hash','transaction','payer_hash',
        'amount_atomic','amount_usdc','payment_network','order_id','revenue','purchase_attribution'])
      and coalesce(metadata->>'protocol','')<>'x402'
    order by occurred_at,id
    limit batch_size
    for update skip locked
  )
  delete from public.api_events e using expired x where e.id=x.id;

  get diagnostics removed=row_count;
  return removed;
end
$$;

create function public.gpd33_prune_events() returns integer
language sql security invoker set search_path = '' as $$
  select gpd33_maintenance.prune_events(1500)
$$;
revoke execute on function gpd33_maintenance.prune_events(integer), public.gpd33_prune_events()
  from public, anon, authenticated;
grant execute on function gpd33_maintenance.prune_events(integer), public.gpd33_prune_events()
  to service_role;

commit;
