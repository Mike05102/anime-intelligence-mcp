#!/usr/bin/env bash
set -euo pipefail
private="${RUNNER_TEMP:?}/gpd33-private"
container="gpd33-restore-${GITHUB_RUN_ID:?}"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run -d --network none --name "$container" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null
for ((attempt=0; attempt<30; attempt++)); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
(( attempt<30 ))
pg() {
  docker run --rm --network none --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$private,target=/private,readonly" \
    --entrypoint pg_restore postgres:17 "$@"
}
pg --list /private/application.dump | awk '
  $4=="TABLE" && $5=="public" && $6=="api_events" {print}
  $4=="TABLE" && $5=="DATA" && $6=="public" && $7=="api_events" {print}
  $4=="SEQUENCE" && $5=="public" && $6=="api_events_id_seq" {print}
  $4=="SEQUENCE" && $5=="SET" && $6=="public" && $7=="api_events_id_seq" {print}
' >"$private/restore.list"
if ! pg --use-list=/private/restore.list --no-owner --no-privileges --file=- /private/application.dump |
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres >"$private/restore.log" 2>&1; then
  echo 'Isolated event table restore failed. Production cleanup withheld.' >&2
  exit 1
fi
[[ "$(docker exec "$container" psql -X -qAt -U postgres -c 'select exists(select 1 from public.api_events)')" == t ]]
echo 'Encrypted archive round-trip and isolated event table restore verified.'
