begin;
create extension if not exists pg_cron with schema extensions;

create table gpd33_maintenance.backlog_state(
  singleton boolean primary key default true check(singleton),
  next_id bigint not null,
  max_id bigint not null,
  expires_at timestamptz not null,
  done boolean not null default false,
  rolled_up bigint not null default 0,
  diagnostics bigint not null default 0,
  batches integer not null default 0,
  last_batch_at timestamptz
);
alter table gpd33_maintenance.backlog_state enable row level security;
revoke all on gpd33_maintenance.backlog_state from public,anon,authenticated,service_role;

create function gpd33_maintenance.run_internal_backlog() returns void
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $job$
declare
  state gpd33_maintenance.backlog_state%rowtype;
  upper_id bigint;
  locked boolean;
  rolled bigint;
  removed bigint;
  groups_written bigint;
begin
  select * into state from gpd33_maintenance.backlog_state where singleton for update skip locked;
  if not found then return; end if;
  if state.done or now()>=state.expires_at then
    if exists(select 1 from cron.job where jobname='gpd33_internal_backlog' and username=current_user) then
      perform cron.unschedule('gpd33_internal_backlog');
    end if;
    return;
  end if;
  upper_id:=least(state.next_id+12000,state.max_id+1);
with parameters as (
  select pg_try_advisory_xact_lock(173302,1) and pg_try_advisory_xact_lock(173302,2) and pg_try_advisory_xact_lock(173302,3) and pg_try_advisory_xact_lock(173302,4) as ready
), payment_requests as materialized (
  select distinct metadata->>'request_id' as request_id
  from public.api_events
  where event_type in ('payment_retry_received','payment_attempt','payment_verified','paid_call',
                       'payment_verify_failed','payment_settlement_failed','x402_failed')
    and nullif(metadata->>'request_id','') is not null
), latest_state as materialized (
  select s.id from (values ('dynamic_catalog_pool'),('catalog_seed_progress')) k(event_type)
  cross join lateral (
    select e.id from public.api_events e where e.event_type=k.event_type
    order by e.occurred_at desc,e.id desc limit 2
  ) s
), assessed as materialized (
  select e.id,e.ctid,
    case
      when e.occurred_at<statement_timestamp()-interval '14 days'
        and e.event_type in ('api_call','x402_gate_entered','payment_required','payment_challenge_issued')
        and e.metadata->>'method' in ('GET','HEAD')
        and e.metadata->'payment_header_present'='false'::jsonb
        and e.metadata->'query_present'='false'::jsonb
        and e.metadata->'id_present'='false'::jsonb
        and not (e.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash',
          'order_id','revenue','purchase_attribution'])
        and nullif(e.metadata->>'intent_query','') is null
        and nullif(e.metadata->>'intent_id','') is null
        and nullif(e.metadata->>'query_text','') is null
        and e.product_id is null and e.payer_hash is null and e.transaction_hash is null
        and (e.event_type not in ('payment_required','payment_challenge_issued')
          or e.metadata->>'response_status'='402')
        and not exists(select 1 from payment_requests p where p.request_id=e.metadata->>'request_id')
        then 'daily_rollup'
      when e.product_id is null and e.payer_hash is null and e.transaction_hash is null
        and e.amount_atomic is null and e.amount_usdc is null and e.payment_network is null
        and not (e.metadata ?| array['payment','settlement','transaction','transaction_hash','payer_hash',
          'amount_atomic','amount_usdc','payment_network','order_id','revenue','purchase_attribution'])
        and coalesce(e.metadata->>'protocol','')<>'x402'
        and (
          (e.occurred_at<statement_timestamp()-interval '14 days' and
            (e.event_type in ('gpd_cron_heartbeat','scheduled_growth_run','discovery_cron_entered',
              'universal_discovery_attempt','universal_discovery_persist_error','universal_provisional_catalog_batch',
              'universal_catalog_frontier','universal_expansion_run')
              or (e.event_type='universal_discovery_batch' and e.endpoint='autonomous_discovery')
              or (e.event_type in ('dynamic_catalog_pool','catalog_seed_progress')
                and not exists(select 1 from latest_state s where s.id=e.id))))
          or (e.occurred_at<statement_timestamp()-interval '1 day' and
            e.event_type in ('gpd_cron_heartbeat','discovery_cron_entered','scheduled_growth_run')
            and coalesce(e.metadata->>'ok','true')<>'false' and not (e.metadata ? 'error')
            and coalesce(e.metadata->'errors','[]'::jsonb)='[]'::jsonb)
          or (e.occurred_at<statement_timestamp()-interval '7 days' and
            (e.event_type in ('universal_discovery_persist_error','identity_preflight_failed','x402_configuration_error')
              or (e.event_type='universal_discovery_attempt' and e.metadata->>'phase'='failed')
              or (e.event_type='scheduled_growth_run' and
                (e.metadata->>'ok'='false' or e.metadata ? 'error'
                or coalesce(e.metadata->'errors','[]'::jsonb)<>'[]'::jsonb))))
        ) then 'expired_diagnostics'
      else 'retain'
    end as action
  from public.api_events e cross join parameters p
  where p.ready and e.id>=state.next_id and e.id<upper_id
), deleted as (
  delete from public.api_events e
  where e.ctid=any(array(select a.ctid from assessed a where a.action<>'retain'))
  returning e.id,e.occurred_at,e.event_type,e.endpoint,e.metadata,e.amount_atomic,e.payment_network
), result as materialized (
  select a.action,d.occurred_at,d.event_type,d.endpoint,d.metadata,d.amount_atomic,d.payment_network
  from deleted d join assessed a on a.id=d.id
), counted as (
  insert into gpd33_maintenance.ingress_daily as totals
  select (occurred_at at time zone 'UTC')::date,event_type,coalesce(endpoint,''),
    coalesce(metadata->>'source_class',''),coalesce(metadata->>'version',''),
    coalesce(amount_atomic,-1),coalesce(payment_network,''),count(*)
  from result where action='daily_rollup' group by 1,2,3,4,5,6,7
  on conflict(day,event_type,endpoint,source_class,version,quoted_atomic,network)
  do update set events=totals.events+excluded.events returning 1
)
select (select ready from parameters) as lock_held,
  count(*) filter(where action='daily_rollup') as rolled_up,
  count(*) filter(where action='expired_diagnostics') as diagnostics,
  (select count(*) from counted) as daily_groups
into locked,rolled,removed,groups_written
from result;


  if not locked then return; end if;
  if rolled>0 and groups_written=0 then raise exception 'ingress totals were not written'; end if;
  update gpd33_maintenance.backlog_state set next_id=upper_id,done=(upper_id>state.max_id),
     rolled_up=rolled_up+rolled,diagnostics=diagnostics+removed,batches=batches+1,last_batch_at=now()
     where singleton;
  if upper_id>state.max_id and exists(select 1 from cron.job where jobname='gpd33_internal_backlog' and username=current_user) then
    perform cron.unschedule('gpd33_internal_backlog');
  end if;
end
$job$;
revoke execute on function gpd33_maintenance.run_internal_backlog() from public,anon,authenticated,service_role;
commit;
