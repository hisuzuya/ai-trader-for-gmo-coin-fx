#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/ai-trade
BRANCH=main
INFISICAL_BOOTSTRAP="$APP_DIR/.infisical-bootstrap.env"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "missing git checkout: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

# Regenerate .env.production from Infisical, the single source of truth for prod env.
# Fail-safe by design: any missing bootstrap / auth / fetch / validation failure keeps the
# existing .env.production untouched, so an Infisical outage can never block a deploy. The file
# is only rewritten when its content actually changes. Requires a root-only bootstrap file holding
# a read-only machine-identity (clientId/secret) + project id (see docs/architecture/operations.md).
regenerate_env_from_infisical() {
  if [ ! -r "$INFISICAL_BOOTSTRAP" ]; then
    echo "infisical: bootstrap not readable ($INFISICAL_BOOTSTRAP); keeping existing .env.production"
    return 0
  fi

  # Load machine-identity creds as non-exported shell vars, then drop the sourced names.
  # shellcheck disable=SC1090
  . "$INFISICAL_BOOTSTRAP"
  local api="${INFISICAL_API_URL:-}" project="${INFISICAL_PROJECT_ID:-}"
  local client_id="${INFISICAL_CLIENT_ID:-}" client_secret="${INFISICAL_CLIENT_SECRET:-}"
  unset INFISICAL_API_URL INFISICAL_PROJECT_ID INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET

  if [ -z "$api" ] || [ -z "$project" ] || [ -z "$client_id" ] || [ -z "$client_secret" ]; then
    echo "WARN: infisical bootstrap incomplete; keeping existing .env.production" >&2
    return 0
  fi

  local token
  # Pass the durable client secret via stdin (not argv) so it never appears in the process list.
  token="$(printf '{"clientId":"%s","clientSecret":"%s"}' "$client_id" "$client_secret" \
    | curl -fsS --max-time 20 -X POST "$api/api/v1/auth/universal-auth/login" \
        -H 'Content-Type: application/json' --data @- 2>/dev/null \
    | jq -r '.accessToken // empty')" || true
  if [ -z "${token:-}" ]; then
    echo "WARN: infisical auth failed; keeping existing .env.production" >&2
    return 0
  fi

  local tmp
  tmp="$(mktemp)"
  if ! curl -fsS --max-time 20 -H "Authorization: Bearer $token" \
      "$api/api/v3/secrets/raw?workspaceId=$project&environment=prod&secretPath=%2F" 2>/dev/null \
      | jq -r '.secrets[] | "\(.secretKey)=\(.secretValue)"' | LC_ALL=C sort > "$tmp"; then
    echo "WARN: infisical fetch failed; keeping existing .env.production" >&2
    rm -f "$tmp"
    return 0
  fi

  # Validate before swapping in: guard against a partial/empty pull clobbering a good file.
  local count
  count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$tmp" || true)"
  if [ "${count:-0}" -lt 10 ]; then
    echo "WARN: infisical returned only ${count:-0} secrets (<10); keeping existing .env.production" >&2
    rm -f "$tmp"
    return 0
  fi
  local req missing=0
  for req in DATABASE_URL WORKER_INTERNAL_TOKEN ANTHROPIC_AUTH_TOKEN WORKER_PORT; do
    grep -qE "^${req}=" "$tmp" || {
      echo "WARN: required key ${req} missing from infisical pull" >&2
      missing=1
    }
  done
  if [ "$missing" -ne 0 ]; then
    echo "WARN: required keys missing; keeping existing .env.production" >&2
    rm -f "$tmp"
    return 0
  fi

  if [ -f .env.production ] && cmp -s "$tmp" .env.production; then
    echo "infisical: .env.production already up to date (${count} secrets)"
    rm -f "$tmp"
    return 0
  fi
  if [ -f .env.production ]; then
    cp -p .env.production ".env.production.bak.$(date +%Y%m%d%H%M%S)"
  fi
  install -m 600 "$tmp" .env.production
  rm -f "$tmp"
  echo "infisical: regenerated .env.production (${count} secrets)"
}

regenerate_env_from_infisical

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
