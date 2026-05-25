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

git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" down --remove-orphans
docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" up -d --build timescaledb
docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" up --build --abort-on-container-exit --exit-code-from db-migrate db-migrate
docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" up -d --build --remove-orphans

docker compose "${COMPOSE_FILE_ARGS[@]}" "${COMPOSE_ENV_ARGS[@]}" ps
