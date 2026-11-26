#!/usr/bin/env bash
set -euo pipefail

# Use a direct connection or the session pooler, with credentials supplied to psql
# through its usual environment or service configuration.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
run_sql() {
  psql -X -v ON_ERROR_STOP=1 "$@"
}

audit="$root/supabase/maintenance/gpd33_storage_audit.sql"
retention="$root/supabase/migrations/20261125060000_gpd33_event_retention.sql"
backup_events() {
  local directory="${GPD33_ARCHIVE_DIR:?Set GPD33_ARCHIVE_DIR to a private backup directory}"
  local archive
  umask 077
  mkdir -p -- "$directory"
  archive="$(mktemp "$directory/gpd33-api-events.XXXXXX")"
  pg_dump --format=custom --table=public.api_events --file="$archive"
  pg_restore --list "$archive" > "$archive.contents"
  grep -q 'TABLE DATA public api_events ' "$archive.contents"
  sha256sum "$archive" > "$archive.sha256"
  sha256sum -c "$archive.sha256"
}

require_rewrite_headroom() {
  local free="${DISK_FREE_BYTES:-}" measured
  if [[ ! "$free" =~ ^[1-9][0-9]{0,9}$ ]]; then
    echo 'Physical rewrite requires DISK_FREE_BYTES from a current disk measurement.' >&2
    return 1
  fi
  measured="$(run_sql -Atc "select pg_total_relation_size('public.api_events')")"
  if [[ ! "$measured" =~ ^[0-9]{1,12}$ ]] || (( free < 2 * measured + 128000000 )); then
    echo 'Physical rewrite withheld because verified headroom is below the conservative table-and-WAL budget.' >&2
    return 1
  fi
}

case "${1:---audit}" in
  --audit)
    run_sql -f "$audit"
    run_sql -f "$root/supabase/maintenance/gpd33_ingress_audit.sql"
    ;;
  --prune)
    backup_events
    installed="$(run_sql -Atc "select to_regprocedure('public.gpd33_prune_events()') is not null")"
    if [[ "$installed" != t ]]; then
      run_sql -f "$retention"
    fi
    compact="$(run_sql -Atc "select to_regprocedure('public.gpd33_ingress_rollup(integer)') is not null")"
    if [[ "$compact" != t ]]; then
      run_sql -f "$root/supabase/migrations/20261125063000_gpd33_compact_telemetry.sql"
    fi
    run_sql -c "set lock_timeout='2s'" -f "$root/supabase/migrations/20261126180000_gpd33_protect_refund_ingress.sql"
    storage="$(run_sql -Atc "select to_regprocedure('public.gpd33_storage_status()') is not null")"
    if [[ "$storage" != t ]]; then
      run_sql -f "$root/supabase/migrations/20261125070000_gpd33_storage_control.sql"
    fi
    total=0
    for ((batch=0;batch<200;batch++)); do
      removed="$(run_sql -Atc 'select gpd33_maintenance.prune_events(5000)')"
      total=$((total + removed))
      if (( removed < 5000 )); then break; fi
    done
    for ((batch=0;batch<200;batch++)); do
      removed="$(run_sql -Atc 'select gpd33_maintenance.compact_ingress(5000)')"
      total=$((total + removed))
      if (( removed < 5000 )); then break; fi
    done
    for ((batch=0;batch<200;batch++)); do
      removed="$(run_sql -Atc 'select gpd33_maintenance.prune_superseded_state(5000)')"
      total=$((total + removed))
      if (( removed < 5000 )); then break; fi
    done
    for ((batch=0;batch<200;batch++)); do
      removed="$(run_sql -Atc 'select gpd33_maintenance.prune_operational_events(5000)')"
      total=$((total + removed))
      if (( removed < 5000 )); then break; fi
    done
    printf 'Eligible rows deleted: %s\n' "$total"
    run_sql -c 'vacuum (analyze) public.api_events'
    run_sql -f "$audit"
    ;;
  --apply)
    require_rewrite_headroom
    bash "$root/supabase/maintenance/run_gpd33_storage.sh" --prune
    bash "$root/supabase/maintenance/run_gpd33_storage.sh" --reclaim
    ;;
  --reclaim)
    require_rewrite_headroom
    # A short lock wait prevents an unexpected queue behind live traffic.
    run_sql -c "set lock_timeout='2s'" -f "$root/supabase/maintenance/gpd33_reclaim_events.sql"
    run_sql -f "$audit"
    ;;
  *)
    printf 'Usage: %s [--audit | --prune | --reclaim | --apply]\n' "$0" >&2
    exit 2
    ;;
esac
