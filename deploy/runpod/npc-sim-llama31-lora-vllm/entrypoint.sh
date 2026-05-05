#!/usr/bin/env bash
set -euo pipefail

VOLUME_ROOT="${RUNPOD_VOLUME_PATH:-/runpod-volume}"
MODEL_CACHE_ROOT="${MODEL_CACHE_ROOT:-${VOLUME_ROOT}/models}"
BASE_MODEL_REPO="${BASE_MODEL_REPO:-unsloth/Meta-Llama-3.1-8B-Instruct}"
BASE_MODEL_REVISION="${BASE_MODEL_REVISION:-a2856192dd7c25b842431f39c179a6c2c2f627d1}"
ADAPTER_REPO="${ADAPTER_REPO:-AutoBot000/npc-sim-manual-llama31-local-check-20260421-025259-adapter}"
ADAPTER_REVISION="${ADAPTER_REVISION:-aa5c65b17f5ab9286f2f2c689cd66f0b0698606e}"
BASE_MODEL_DIR="${BASE_MODEL_DIR:-${MODEL_CACHE_ROOT}/llama31}"
ADAPTER_DIR="${ADAPTER_DIR:-${MODEL_CACHE_ROOT}/npc_adapter}"
SERVED_BASE_MODEL="${SERVED_BASE_MODEL:-unsloth/Meta-Llama-3.1-8B-Instruct}"
SERVED_LORA_MODEL="${SERVED_LORA_MODEL:-npc-sim-manual-llama31-local-check-20260421-025259}"
PORT="${PORT:-8000}"
VLLM_PORT="${VLLM_PORT:-8001}"
PORT_HEALTH="${PORT_HEALTH:-8000}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-4096}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.90}"
MAX_LORAS="${MAX_LORAS:-1}"
MAX_LORA_RANK="${MAX_LORA_RANK:-8}"
ENABLE_LORA="${ENABLE_LORA:-true}"
PREFILL_ONLY="${PREFILL_ONLY:-false}"
PREFILL_STATUS_PATH="${PREFILL_STATUS_PATH:-/tmp/npc-sim-prefill-status.json}"

export PORT PORT_HEALTH VLLM_PORT
export PREFILL_STATUS_PATH
export HF_HUB_ENABLE_HF_TRANSFER="${HF_HUB_ENABLE_HF_TRANSFER:-1}"
export TOKENIZERS_PARALLELISM="${TOKENIZERS_PARALLELISM:-false}"

choose_vllm_port() {
  python3 - <<'PY'
import os
import socket

start = int(os.environ.get("VLLM_PORT", "8001"))
for port in range(start, start + 20):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            continue
        print(port)
        break
else:
    raise SystemExit(f"No free vLLM port found from {start} to {start + 19}")
PY
}

mkdir -p "${MODEL_CACHE_ROOT}"

if [[ "${PREFILL_ONLY}" == "true" ]]; then
  echo '{"status":"initializing"}' > "${PREFILL_STATUS_PATH}"
  echo "Starting prefill status server on port ${PORT}"
  python3 -u /opt/npc-sim/prefill_server.py &
  PROXY_PID="$!"
else
  VLLM_PORT="$(choose_vllm_port)"
  export VLLM_PORT
  export VLLM_UPSTREAM="http://127.0.0.1:${VLLM_PORT}"
  echo "Starting public proxy on port ${PORT}; vLLM will start on internal port ${VLLM_PORT}"
  python3 -u /opt/npc-sim/proxy_server.py &
  PROXY_PID="$!"
fi
VLLM_PID=""
trap 'kill "${VLLM_PID}" "${PROXY_PID}" 2>/dev/null || true' EXIT

if [[ -f "${BASE_MODEL_DIR}/config.json" ]] && find "${BASE_MODEL_DIR}" -maxdepth 1 -name "*.safetensors" -print -quit | grep -q .; then
  echo "Base model cache hit by files: ${BASE_MODEL_DIR}"
else
  echo "Preparing base model cache: ${BASE_MODEL_REPO}@${BASE_MODEL_REVISION} -> ${BASE_MODEL_DIR}"
  python3 /opt/npc-sim/download_snapshot.py \
    --repo-id "${BASE_MODEL_REPO}" \
    --revision "${BASE_MODEL_REVISION}" \
    --local-dir "${BASE_MODEL_DIR}" \
    --ignore-pattern "*.gguf" \
    --ignore-pattern "*.pth" \
    --ignore-pattern "original/*"
fi

if [[ "${ENABLE_LORA}" != "false" ]]; then
  if [[ -f "${ADAPTER_DIR}/adapter_config.json" && -f "${ADAPTER_DIR}/adapter_model.safetensors" ]]; then
    echo "LoRA adapter cache hit by files: ${ADAPTER_DIR}"
  else
    echo "Preparing LoRA adapter cache: ${ADAPTER_REPO}@${ADAPTER_REVISION} -> ${ADAPTER_DIR}"
    python3 /opt/npc-sim/download_snapshot.py \
      --repo-id "${ADAPTER_REPO}" \
      --revision "${ADAPTER_REVISION}" \
      --local-dir "${ADAPTER_DIR}" \
      --allow-pattern "adapter_config.json" \
      --allow-pattern "adapter_model.safetensors" \
      --allow-pattern "README.md" \
      --allow-pattern "chat_template.jinja" \
      --allow-pattern "tokenizer.json" \
      --allow-pattern "tokenizer_config.json"
  fi
fi

if [[ "${PREFILL_ONLY}" == "true" ]]; then
  echo '{"status":"ok"}' > "${PREFILL_STATUS_PATH}"
  echo "Prefill complete. Holding container for inspection until Runpod stops the worker."
  wait "${PROXY_PID}"
fi

VLLM_ARGS=(
  serve "${BASE_MODEL_DIR}"
  --served-model-name "${SERVED_BASE_MODEL}"
  --host 0.0.0.0
  --port "${VLLM_PORT}"
  --enable-prefix-caching
  --max-model-len "${MAX_MODEL_LEN}"
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}"
)

if [[ "${ENABLE_LORA}" != "false" ]]; then
  VLLM_ARGS+=(
    --enable-lora
    --max-loras "${MAX_LORAS}"
    --max-lora-rank "${MAX_LORA_RANK}"
    --lora-modules "${SERVED_LORA_MODEL}=${ADAPTER_DIR}"
  )
fi

if [[ -n "${VLLM_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS=(${VLLM_EXTRA_ARGS})
  VLLM_ARGS+=("${EXTRA_ARGS[@]}")
fi

echo "Starting vLLM on internal port ${VLLM_PORT}"
vllm "${VLLM_ARGS[@]}" &
VLLM_PID="$!"

wait "${VLLM_PID}"
