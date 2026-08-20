#!/usr/bin/env bash
set -Eeuo pipefail

source_dir="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
deploy_dir="${DEPLOY_DIR:-/opt/npc-simulator}"

if [[ ! -d "$source_dir" ]]; then
  echo "Deployment source directory does not exist: $source_dir" >&2
  exit 1
fi

if [[ ! -d "$deploy_dir" ]]; then
  echo "Deployment directory does not exist: $deploy_dir" >&2
  exit 1
fi

rsync -a --delete \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.venv/' \
  --exclude='data/' \
  --exclude='logs/' \
  --exclude='outputs/' \
  --exclude='artifacts/' \
  --exclude='backend/storage/' \
  --exclude='docs/' \
  "$source_dir/" "$deploy_dir/"

cd "$deploy_dir"
docker compose config --quiet
BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose build frontend backend
docker compose up -d --no-build frontend backend

for attempt in {1..30}; do
  if curl -fsS --max-time 5 http://127.0.0.1:8080/actuator/health | grep -q '"status":"UP"'; then
    echo "Production health check passed on attempt $attempt."
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "Production health check failed." >&2
docker compose ps >&2
docker compose logs --tail=120 backend >&2
exit 1
