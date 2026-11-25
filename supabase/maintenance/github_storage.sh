#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /work
export PGCONNECT_TIMEOUT=12
sql() { psql -X -qAt -v ON_ERROR_STOP=1 "$@"; }

# Ensure that a DSN accidentally pointed at another project cannot start cleanup.
routines="$(sql -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='gpd33_maintenance' and p.proname in ('compact_ingress','prune_operational_events')")"
[[ "$routines" == 2 ]] || { echo "Expected GPD maintenance routines are missing." >&2; exit 1; }
case "$1" in
  check)
    echo "TLS-verified database connection and GPD maintenance routines confirmed."
    ;;
  egress-check)
    [[ "$2" =~ ^[1-9][0-9]{0,9}$ ]] || exit 1
    (( $2<=5000000000 )) || exit 1
    logical_bytes="$(sql <<'SQL' | awk '{bytes+=$1} END {printf "%.0f",bytes}'
select format('select coalesce(sum(octet_length(row_to_json(t)::text)),0) from only %I.%I t;',
              n.nspname,c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','gpd33_maintenance') and c.relkind='r'
\gexec
SQL
)"
    [[ "$logical_bytes" =~ ^[0-9]+$ ]]
    # Reserve twice the logical JSON size for COPY encoding, schema and
    # concurrent writes. Local archive compression does not reduce DB egress.
    if (( 2 * logical_bytes + 100000000 > $2 )); then
      echo 'Uncached egress remaining is below the backup estimate.' >&2
      exit 1
    fi
    ;;
  backup)
    sql -c 'select coalesce(max(id),0) from public.api_events' >/private/archive.fence
    pg_dump --format=custom --compress=9 --no-owner --no-privileges \
      --schema=public --schema=gpd33_maintenance --file=/private/application.dump
    pg_restore --list /private/application.dump >/private/toc
    grep -q 'TABLE DATA public api_events ' /private/toc
    grep -q 'TABLE DATA public products ' /private/toc
    pg_restore --file=/dev/null /private/application.dump
    ;;
  apply)
    [[ "$2" =~ ^[0-9]{1,10}$ ]]
    [[ -s /private/application.dump ]]
    pg_restore --file=/dev/null /private/application.dump
    fence="$(cat /private/archive.fence)"
    [[ "$fence" =~ ^[0-9]+$ ]]
    start_lsn="$(sql -c 'select pg_current_wal_insert_lsn()')"
    [[ "$start_lsn" =~ ^[0-9A-F]+/[0-9A-F]+$ ]]
    # A database-wide application backup is held outside the database.
    # No legacy data is removed until the artifact has been round-tripped.
    for fn in prune_events compact_ingress prune_superseded_state prune_operational_events; do
      for (( batch=0; batch<200; batch++ )); do
        count="$(sql <<SQL
begin;
set local lock_timeout='2s';
lock table public.api_events in share row exclusive mode;
do \$guard\$
begin
  if exists(select 1 from public.api_events where id>$fence and occurred_at<statement_timestamp()-interval '1 day')
  then raise exception 'Backdated rows appeared beyond the archive fence'; end if;
end
\$guard\$;
select gpd33_maintenance.$fn(5000);
commit;
SQL
)"
        [[ "$count" =~ ^[0-9]+$ ]]
        if (( count==0 )); then break; fi
      done
      (( batch<200 )) || { echo 'Backlog remains after the bounded pass.' >&2; exit 1; }
    done
    sql -c 'vacuum (analyze) public.api_events'
    # Size surviving tuples and indexes, then allow space for both the
    # replacement and WAL with an additional working margin.
    estimate="$(sql -c "select (coalesce(sum(pg_column_size(e)+pg_column_size(e.metadata)+192),0)+pg_indexes_size('public.api_events'))::bigint from public.api_events e")"
    [[ "$estimate" =~ ^[0-9]+$ ]]
    wal="$(sql -c "select pg_wal_lsn_diff(pg_current_wal_insert_lsn(),'$start_lsn')::bigint")"
    [[ "$wal" =~ ^[0-9]+$ ]]
    if (( 2 * estimate + wal + 128000000 > $2 )); then
      echo 'Logged rows were compacted. Physical rewrite withheld because verified headroom was below the estimate.' >&2
      exit 1
    fi
    sql -c "set lock_timeout='2s'" -c "set statement_timeout='15min'" -c 'vacuum (full, analyze) public.api_events'
    bytes="$(sql -c 'select pg_database_size(current_database())')"
    echo "Post-maintenance database size measured."
    echo "db_bytes=$bytes" >> /private/result
    ;;
  catalog)
    bytes="$(sql -c 'select pg_database_size(current_database())')"
    (( bytes < 400000000 )) || { echo 'Catalog migration withheld at or above 400 MB.' >&2; exit 1; }
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_catalog_batch(jsonb,uuid)') is not null")" != t ]]; then
      sql -c "set lock_timeout='2s'" -f supabase/migrations/20261125053000_gpd33_catalog.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_health_events()') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125073000_gpd33_egress.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_business_outcomes()') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125080000_gpd33_business_outcomes.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_create_handoff(uuid,uuid,integer)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125083000_gpd33_merchant_handoffs.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_buyer_handoff_status(uuid)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125090000_gpd33_buyer_tracking.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_catalog_planning()') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125093500_gpd33_catalog_planning.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_create_buyer_handoff(uuid,uuid,uuid,integer,text)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125100000_gpd33_buyer_self_service.sql
    fi
    if [[ "$(sql -c "select to_regclass('public.gpd33_active_offer_gtin') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125101500_gpd33_merchant_gtin.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_request_buyer_handoff(uuid,uuid,uuid,integer,text,text)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125103000_gpd33_offer_bound_handoff.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_catalog_planning_growth()') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125104500_gpd33_growth_signals.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_import_merchant_feed(uuid,jsonb)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125110000_gpd33_merchant_feed_import.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_offer_source_fresh(timestamptz)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125111500_gpd33_offer_source_freshness.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_bulk_quantity_unreported(integer,numeric)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125113000_gpd33_offer_quantity.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_import_merchant_stock_feed(uuid,jsonb)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125114500_gpd33_merchant_stock_feed.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_request_condition_bound_handoff(uuid,uuid,uuid,integer,text,text,text)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125120000_gpd33_handoff_condition.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_feed_condition_label(text)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125121500_gpd33_feed_observed_condition.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_ingest_reconciled_growth(uuid,bigint,text,jsonb)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125123000_gpd33_reconciled_growth.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_list_buyer_handoffs(uuid,uuid,integer)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125124500_gpd33_buyer_handoff_list.sql
    fi
    if [[ "$(sql -c "select to_regprocedure('public.gpd33_export_handoff_evidence(bigint,jsonb)') is not null")" != t ]]; then
      sql -f supabase/migrations/20261125125000_gpd33_handoff_evidence.sql
    fi
    [[ "$(sql -c "select public.gpd33_coverage(array['food_grocery']) ? 'food_grocery'")" == t ]]
    [[ "$(sql -c 'select pg_database_size(current_database()) < 400000000')" == t ]]
    ;;
  *) exit 2 ;;
esac
