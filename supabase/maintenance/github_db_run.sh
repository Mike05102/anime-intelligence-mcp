#!/usr/bin/env bash
set -euo pipefail
private="${RUNNER_TEMP:?}/gpd33-private"
# Keep database errors in job-local storage. SQL diagnostics can contain row data.
if ! docker run --rm --network host --user "$(id -u):$(id -g)" \
    --env-file "$private/db.env" \
    --mount "type=bind,source=$PWD,target=/work,readonly" \
    --mount "type=bind,source=$private,target=/private" \
    --entrypoint bash postgres:17 /work/supabase/maintenance/github_storage.sh "$@" \
    >"$private/operation.log" 2>&1; then
  echo "Database step '$1' stopped. Check connection, rewrite headroom or the 400 MB deployment gate." >&2
  exit 1
fi
case "$1" in
  check) echo 'TLS-verified database connection confirmed.' ;;
  backup) echo 'Application backup decoded and its table entries verified.' ;;
  apply) echo 'Cleanup, physical rewrite and remeasurement completed.' ;;
  catalog) echo 'Catalog schema verified below the deployment target.' ;;
esac
