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
  if grep -Eiq 'password authentication failed|no password supplied|authentication failed' "$private/operation.log"; then
    echo 'Database authentication failed. Check the database password in the GitHub secret.' >&2
  elif grep -Eiq 'does not match host|hostname mismatch' "$private/operation.log"; then
    echo 'The PostgreSQL certificate does not match the configured hostname.' >&2
  elif grep -Eiq 'root certificate file.*(does not exist|could not)|could not read root certificate' "$private/operation.log"; then
    echo 'The runner could not read the configured database CA file.' >&2
  elif grep -Eiq 'certificate verify failed|unable to get local issuer|self.signed certificate' "$private/operation.log"; then
    echo 'The PostgreSQL certificate did not chain to a trusted CA.' >&2
  elif grep -Eiq 'certificate|TLS|SSL error' "$private/operation.log"; then
    echo 'Database TLS negotiation failed. Check the Supabase connection endpoint and CA.' >&2
  elif grep -Eiq 'tenant or user not found|invalid user|role .* does not exist' "$private/operation.log"; then
    echo 'Supabase pooler could not match the project or database username.' >&2
  elif grep -Eiq 'network is unreachable|connection refused|timeout expired|could not translate host|no route to host' "$private/operation.log"; then
    echo 'The runner could not reach the configured PostgreSQL endpoint. Use the Supabase Session pooler on port 5432.' >&2
  elif grep -q 'Expected GPD maintenance routines are missing' "$private/operation.log"; then
    echo 'Connection succeeded but the target does not expose the expected GPD maintenance routines.' >&2
  else
    echo "Database step '$1' stopped. Check connection, rewrite headroom or the 400 MB deployment gate." >&2
  fi
  exit 1
fi
case "$1" in
  check) echo 'TLS-verified database connection confirmed.' ;;
  egress-check) echo 'Estimated backup transfer fits within the supplied uncached egress remaining.' ;;
  backup) echo 'Application backup decoded and its table entries verified.' ;;
  apply) echo 'Cleanup, physical rewrite and remeasurement completed.' ;;
  catalog) echo 'Catalog schema verified below the deployment target.' ;;
esac
