-- Read-only progress report for an installation with the internal backlog and vacuum checkpoint.
-- Sizes come from Postgres and do not measure filesystem free space or transfer quota.
with relations as (
  select pg_database_size(current_database()) as database_bytes,
         pg_total_relation_size('public.api_events') as events_bytes,
         pg_total_relation_size('public.products') as products_bytes
), progress as (
  select b.done, b.batches, b.rolled_up, b.diagnostics, b.last_batch_at,
         greatest(0, b.max_id - b.next_id + 1) as remaining_id_span,
         v.status as vacuum_status, v.completed_at, v.payment_count, v.payment_protected,
         case when v.event_before is not null and v.event_after is not null
              then greatest(0, v.event_before - v.event_after) end as observed_vacuum_reclaim_bytes
  from gpd33_maintenance.backlog_state b
  join gpd33_maintenance.vacuum_checkpoint v using (singleton)
  where b.singleton
)
select statement_timestamp() as observed_at, r.*,
       greatest(0, 400000000 - (r.database_bytes - r.events_bytes)) as event_budget_to_400m,
       (select to_jsonb(p) from progress p) as maintenance,
       (select count(*) from pg_locks
         where relation in ('public.api_events'::regclass,'public.products'::regclass) and not granted) as relation_lock_waits,
       (select count(*) from pg_stat_progress_cluster where relid = 'public.api_events'::regclass) as event_rewrites_running,
       (select count(*) from pg_stat_progress_vacuum where relid = 'public.api_events'::regclass) as event_vacuums_running,
       (select n_live_tup from pg_stat_user_tables where relid = 'public.products'::regclass) as products_estimated_rows
from relations r;
