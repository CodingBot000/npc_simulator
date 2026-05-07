#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTERNAL_LLM_PROVIDER_MODE="${LLM_PROVIDER_MODE-}"
EXTERNAL_FINAL_REPLY_MODE="${FINAL_REPLY_MODE-}"
EXTERNAL_FINAL_REPLY_BACKEND="${FINAL_REPLY_BACKEND-}"

load_env_file() {
  local file_path="$1"
  if [[ -f "$file_path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file_path"
    set +a
  fi
}

fail() {
  printf '[local-baseten] %s\n' "$*" >&2
  exit 1
}

require_env() {
  local key="$1"
  local value="${!key-}"
  if [[ -z "${value}" ]]; then
    fail "$key is required. Put it in .env.local or export it before running this script."
  fi
}

load_env_file "$ROOT_DIR/.env"
load_env_file "$ROOT_DIR/.env.local"

export LLM_PROVIDER_MODE="${EXTERNAL_LLM_PROVIDER_MODE:-${LLM_PROVIDER_MODE:-openai}}"
export FINAL_REPLY_MODE="${EXTERNAL_FINAL_REPLY_MODE:-on}"
export FINAL_REPLY_BACKEND="${EXTERNAL_FINAL_REPLY_BACKEND:-baseten}"
export INTERACTION_JUDGE_MODE="${INTERACTION_JUDGE_MODE:-on}"
export INTERACTION_JUDGE_MODEL="${INTERACTION_JUDGE_MODEL:-gpt-5-nano}"
export INTERACTION_JUDGE_TIMEOUT_MS="${INTERACTION_JUDGE_TIMEOUT_MS:-8000}"
export INTERACTION_JUDGE_MAX_OUTPUT_TOKENS="${INTERACTION_JUDGE_MAX_OUTPUT_TOKENS:-400}"
export INTERACTION_JUDGE_ENFORCEMENT="${INTERACTION_JUDGE_ENFORCEMENT:-off}"

if [[ "$FINAL_REPLY_MODE" != "off" && "$FINAL_REPLY_BACKEND" == "baseten" ]]; then
  require_env BASETEN_API_KEY
  require_env FINAL_REPLY_REMOTE_MODEL_NAME
  if [[ -z "${FINAL_REPLY_BASETEN_MODEL_ID-}" && -z "${FINAL_REPLY_BASETEN_MODEL_URL-}" ]]; then
    fail "FINAL_REPLY_BASETEN_MODEL_ID or FINAL_REPLY_BASETEN_MODEL_URL is required."
  fi
fi

if [[ "$LLM_PROVIDER_MODE" == "openai" ]]; then
  require_env OPENAI_API_KEY
fi

exec "$ROOT_DIR/run-local-host.sh" "$@"
