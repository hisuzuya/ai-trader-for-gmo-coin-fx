#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/ai-trade
BRANCH=main

if [ ! -d "$APP_DIR/.git" ]; then
  echo "missing git checkout: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

COMPOSE_ENV_ARGS=()
if [ -f .env.production ]; then
  COMPOSE_ENV_ARGS=(--env-file .env.production)
fi
COMPOSE_FILE_ARGS=(-f docker/compose.yml)

disable_legacy_compose_overlays() {
  local backup_dir
  local dest_dir
  local file

  backup_dir="deploy-backups/legacy-compose-$(date +%Y%m%d%H%M%S)"

  for file in \
    docker-compose.yml \
    docker-compose.override.yml \
    compose.production.yml \
    compose.runtime.yml \
    docker/compose.runtime.yml \
    docker/compose.override.yml; do
    if [ -f "$file" ]; then
      dest_dir="$backup_dir/$(dirname "$file")"
      mkdir -p "$dest_dir"
      mv "$file" "$dest_dir/$(basename "$file")"
      echo "disabled legacy compose overlay: $file -> $backup_dir/$file"
    fi
  done
}

wait_service_healthy() {
  local service
  local container_id
  local status
  local attempt

  for service in "$@"; do
    for attempt in $(seq 1 60); do
      container_id="$(docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" ps -q "$service")"

      if [ -z "$container_id" ]; then
        status="missing"
        sleep 2
        continue
      fi

      status="$(
        docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null ||
          echo "missing"
      )"

      if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
        break
      fi

      if [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
        echo "service $service became $status" >&2
        docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" logs --tail=120 "$service" >&2
        exit 1
      fi

      sleep 2
    done

    if [ "$status" != "healthy" ] && [ "$status" != "running" ]; then
      echo "service $service did not become healthy, final status: $status" >&2
      docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" logs --tail=120 "$service" >&2
      exit 1
    fi
  done
}

git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
disable_legacy_compose_overlays

docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" down --remove-orphans
docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" up -d --build timescaledb
wait_service_healthy timescaledb
docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" up --build --abort-on-container-exit --exit-code-from db-migrate db-migrate
docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" up -d --build --no-deps ai-runner mcp-agent-research
wait_service_healthy ai-runner mcp-agent-research
docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" up -d --build --no-deps worker
wait_service_healthy worker
docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" up -d --build --no-deps next-web
wait_service_healthy next-web

docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" ps
