#!/usr/bin/env bash
set -euo pipefail

export LLM_PROVIDER_MODE="${LLM_PROVIDER_MODE:-codex}"
export FINAL_REPLY_MODE="${FINAL_REPLY_MODE:-on}"
export FINAL_REPLY_BACKEND="${FINAL_REPLY_BACKEND:-baseten}"
export FINAL_REPLY_BASETEN_MODEL_ID="${FINAL_REPLY_BASETEN_MODEL_ID:-qeld1153}"
export FINAL_REPLY_BASETEN_MODEL_URL="${FINAL_REPLY_BASETEN_MODEL_URL:-https://model-qeld1153.api.baseten.co/environments/production/sync/v1}"
export FINAL_REPLY_REMOTE_MODEL_NAME="${FINAL_REPLY_REMOTE_MODEL_NAME:-npc-sim-manual-llama31-local-check-20260421-025259}"

exec ./run-local-host.sh "$@"
