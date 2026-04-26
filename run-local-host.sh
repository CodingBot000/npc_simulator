#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.local.yml"
BACKEND_DIR="$ROOT_DIR/backend"

BACKEND_ONLY=0
SKIP_POSTGRES=0

EXTERNAL_LLM_PROVIDER_MODE="${LLM_PROVIDER_MODE-__unset__}"
EXTERNAL_FINAL_REPLY_MODE="${FINAL_REPLY_MODE-__unset__}"
EXTERNAL_FINAL_REPLY_BACKEND="${FINAL_REPLY_BACKEND-__unset__}"
EXTERNAL_VITE_API_BASE_URL="${VITE_API_BASE_URL-__unset__}"

BACKEND_PID=""

usage() {
  cat <<'EOF'
Usage: ./run-local-host.sh [--backend-only] [--skip-postgres]

Default behavior:
1. Starts the local Postgres container only
2. Runs Spring Boot backend on the host with Codex CLI + local MLX Llama
3. Waits for backend health
4. Runs the Vite frontend on the host

Options:
  --backend-only   Start Postgres + backend only
  --skip-postgres  Do not start the Docker Postgres service
  -h, --help       Show this help

Env overrides:
  LLM_PROVIDER_MODE
  FINAL_REPLY_MODE
  FINAL_REPLY_BACKEND
  VITE_API_BASE_URL
EOF
}

log() {
  printf '[local-host] %s\n' "$*"
}

fail() {
  printf '[local-host] %s\n' "$*" >&2
  exit 1
}

load_env_file() {
  local file_path="$1"
  if [[ -f "$file_path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file_path"
    set +a
  fi
}

require_command() {
  local command_name="$1"
  local help_text="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    fail "$command_name is required. $help_text"
  fi
}

cleanup() {
  local exit_code=$?
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    log "stopping backend"
    pkill -TERM -P "$BACKEND_PID" >/dev/null 2>&1 || true
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}

wait_for_postgres() {
  local attempts=60
  local index

  for ((index = 1; index <= attempts; index += 1)); do
    if docker compose -f "$COMPOSE_FILE" exec -T postgres \
      pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      log "postgres is ready"
      return 0
    fi
    sleep 1
  done

  fail "postgres did not become ready within ${attempts}s"
}

wait_for_backend_health() {
  local health_url="http://127.0.0.1:${BACKEND_PORT}/actuator/health"
  local attempts=120
  local index

  for ((index = 1; index <= attempts; index += 1)); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      log "backend health check passed: $health_url"
      return 0
    fi

    if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      fail "backend exited before the health check passed"
    fi

    sleep 1
  done

  fail "backend health check timed out: $health_url"
}

start_postgres() {
  log "starting Docker Postgres service"
  docker compose -f "$COMPOSE_FILE" up -d postgres >/dev/null
  wait_for_postgres
}

start_backend() {
  log "starting backend on http://127.0.0.1:${BACKEND_PORT}"
  (
    cd "$BACKEND_DIR"
    ./gradlew --no-daemon bootRun
  ) > >(sed 's/^/[backend] /') 2> >(sed 's/^/[backend] /' >&2) &
  BACKEND_PID=$!
  wait_for_backend_health
}

start_frontend() {
  log "starting frontend on http://127.0.0.1:${FRONTEND_DEV_PORT}"
  (
    cd "$ROOT_DIR"
    npm --workspace frontend run dev -- --host 0.0.0.0 --port "$FRONTEND_DEV_PORT"
  ) > >(sed 's/^/[frontend] /') 2> >(sed 's/^/[frontend] /' >&2)
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only)
      BACKEND_ONLY=1
      shift
      ;;
    --skip-postgres)
      SKIP_POSTGRES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      fail "unknown argument: $1"
      ;;
  esac
done

trap cleanup EXIT INT TERM

load_env_file "$ROOT_DIR/.env"
load_env_file "$ROOT_DIR/.env.local"

export NPC_SIMULATOR_DEPLOYMENT_MODE="${NPC_SIMULATOR_DEPLOYMENT_MODE:-local}"
export FRONTEND_HOST_PORT="${FRONTEND_HOST_PORT:-3000}"
export FRONTEND_DEV_PORT="${FRONTEND_DEV_PORT:-$FRONTEND_HOST_PORT}"
export BACKEND_PORT="${BACKEND_PORT:-8080}"
export BACKEND_STORAGE_ROOT="${BACKEND_STORAGE_ROOT:-$ROOT_DIR/backend/storage}"
export SPRING_PROFILES_ACTIVE="${SPRING_PROFILES_ACTIVE:-local}"

export POSTGRES_DB="${POSTGRES_DB:-npc_simulator}"
export POSTGRES_USER="${POSTGRES_USER:-npc_simulator}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-npc_simulator}"
export SPRING_DATASOURCE_URL="${SPRING_DATASOURCE_URL:-jdbc:postgresql://localhost:5432/${POSTGRES_DB}}"
export SPRING_DATASOURCE_USERNAME="${SPRING_DATASOURCE_USERNAME:-$POSTGRES_USER}"
export SPRING_DATASOURCE_PASSWORD="${SPRING_DATASOURCE_PASSWORD:-$POSTGRES_PASSWORD}"

export NPC_SIMULATOR_ROOT="${NPC_SIMULATOR_ROOT:-$ROOT_DIR}"
export NPC_SIMULATOR_WORKDIR="${NPC_SIMULATOR_WORKDIR:-$ROOT_DIR}"
export NPC_SIMULATOR_SCRIPTS_ROOT="${NPC_SIMULATOR_SCRIPTS_ROOT:-$ROOT_DIR/backend/scripts}"
export NPC_SIMULATOR_NODE_BIN_DIR="${NPC_SIMULATOR_NODE_BIN_DIR:-$ROOT_DIR/node_modules/.bin}"
export NPC_SIMULATOR_DATA_ROOT="${NPC_SIMULATOR_DATA_ROOT:-$ROOT_DIR/data}"
export NPC_SIMULATOR_OUTPUTS_ROOT="${NPC_SIMULATOR_OUTPUTS_ROOT:-$ROOT_DIR/outputs}"
export NPC_SIMULATOR_VENV_ROOT="${NPC_SIMULATOR_VENV_ROOT:-$ROOT_DIR/.venv}"
export NPC_SIMULATOR_BRIDGE_ENABLED="${NPC_SIMULATOR_BRIDGE_ENABLED:-true}"
export NPC_SIMULATOR_BRIDGE_TIMEOUT_SECONDS="${NPC_SIMULATOR_BRIDGE_TIMEOUT_SECONDS:-420}"
export NPC_SIMULATOR_CORS_ALLOWED_ORIGINS="${NPC_SIMULATOR_CORS_ALLOWED_ORIGINS:-http://localhost:${FRONTEND_DEV_PORT},http://127.0.0.1:${FRONTEND_DEV_PORT}}"
export LOCAL_REPLY_MODEL_FAMILY="${LOCAL_REPLY_MODEL_FAMILY:-llama}"
export LOCAL_REPLY_LLAMA_RUNTIME_PATH="${LOCAL_REPLY_LLAMA_RUNTIME_PATH:-outputs/training/manual_llama31_local_check_20260421_025259/runtime}"

if [[ "$EXTERNAL_LLM_PROVIDER_MODE" == "__unset__" ]]; then
  export LLM_PROVIDER_MODE="codex"
else
  export LLM_PROVIDER_MODE="$EXTERNAL_LLM_PROVIDER_MODE"
fi

if [[ "$EXTERNAL_FINAL_REPLY_MODE" == "__unset__" ]]; then
  export FINAL_REPLY_MODE="on"
else
  export FINAL_REPLY_MODE="$EXTERNAL_FINAL_REPLY_MODE"
fi

if [[ "$EXTERNAL_FINAL_REPLY_BACKEND" == "__unset__" ]]; then
  export FINAL_REPLY_BACKEND="local_llama"
else
  export FINAL_REPLY_BACKEND="$EXTERNAL_FINAL_REPLY_BACKEND"
fi

if [[ "$EXTERNAL_VITE_API_BASE_URL" == "__unset__" ]]; then
  export VITE_API_BASE_URL="http://127.0.0.1:${BACKEND_PORT}"
else
  export VITE_API_BASE_URL="$EXTERNAL_VITE_API_BASE_URL"
fi

mkdir -p "$BACKEND_STORAGE_ROOT"

require_command curl "curl is used for the backend health check."
require_command npm "Run this script in a Node/npm environment."

if [[ "$SKIP_POSTGRES" -eq 0 ]]; then
  require_command docker "Install Docker Desktop first."
fi

if [[ ! -x "$BACKEND_DIR/gradlew" ]]; then
  fail "backend/gradlew is missing or not executable"
fi

if [[ ! -x "$NPC_SIMULATOR_NODE_BIN_DIR/tsx" ]]; then
  fail "tsx is missing at $NPC_SIMULATOR_NODE_BIN_DIR/tsx. Run: npm install"
fi

if [[ "$LLM_PROVIDER_MODE" == "codex" ]]; then
  require_command codex "Codex CLI must be installed for local CLI-auth runs."
  if [[ ! -d "$HOME/.codex" ]]; then
    fail "~/.codex is missing. Run codex login first."
  fi
fi

if [[ "$FINAL_REPLY_MODE" != "off" && "$FINAL_REPLY_BACKEND" == "local_llama" ]]; then
  if [[ ! -x "$ROOT_DIR/.venv/bin/mlx_lm.generate" ]]; then
    fail "MLX runtime is missing at $ROOT_DIR/.venv/bin/mlx_lm.generate"
  fi

  if [[ "$LOCAL_REPLY_LLAMA_RUNTIME_PATH" = /* ]]; then
    LOCAL_LLAMA_RUNTIME_DIR="$LOCAL_REPLY_LLAMA_RUNTIME_PATH"
  else
    LOCAL_LLAMA_RUNTIME_DIR="$ROOT_DIR/$LOCAL_REPLY_LLAMA_RUNTIME_PATH"
  fi

  if [[ ! -d "$LOCAL_LLAMA_RUNTIME_DIR" ]]; then
    fail "local llama runtime path is missing: $LOCAL_LLAMA_RUNTIME_DIR"
  fi
fi

log "configuration"
log "  postgres: $([[ "$SKIP_POSTGRES" -eq 1 ]] && echo "skip" || echo "docker compose service")"
log "  backend:  http://127.0.0.1:${BACKEND_PORT}"
log "  frontend: http://127.0.0.1:${FRONTEND_DEV_PORT}"
log "  llm:      ${LLM_PROVIDER_MODE}"
log "  final:    mode=${FINAL_REPLY_MODE}, backend=${FINAL_REPLY_BACKEND}"

if [[ "$SKIP_POSTGRES" -eq 0 ]]; then
  start_postgres
fi

start_backend

if [[ "$BACKEND_ONLY" -eq 1 ]]; then
  log "backend-only mode; press Ctrl+C to stop"
  wait "$BACKEND_PID"
else
  start_frontend
fi
