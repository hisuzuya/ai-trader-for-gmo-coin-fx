#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/ai-trade
BRANCH=main

if [ ! -d "$APP_DIR/.git" ]; then
  echo "missing git checkout: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

docker compose down --remove-orphans
docker compose up -d --build --remove-orphans

docker compose ps
