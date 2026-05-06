# Runpod Custom vLLM + LoRA Load Balancer

This image runs the same serving shape that worked on Baseten:

- `vllm/vllm-openai:v0.7.3`
- `unsloth/Meta-Llama-3.1-8B-Instruct`
- PEFT LoRA adapter `AutoBot000/npc-sim-manual-llama31-local-check-20260421-025259-adapter`
- OpenAI-compatible `/v1/chat/completions`
- Runpod Load Balancer health check through `/ping`
- model files cached on a mounted Runpod network volume

The image does not bake model weights into Docker. It downloads base model and adapter into
`/workspace/models/*` on first boot, then reuses the mounted volume on later cold starts.

## Build

```bash
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -f deploy/runpod/npc-sim-llama31-lora-vllm/Dockerfile \
  -t <registry>/npc-sim-llama31-lora-vllm:20260505 \
  --push \
  deploy/runpod/npc-sim-llama31-lora-vllm
```

## Push

```bash
docker push <registry>/npc-sim-llama31-lora-vllm:20260504
```

## Required Runpod Template Settings

- Endpoint type: `Load Balancer`
- Container image: pushed image tag
- HTTP ports: `8000/http`
- Env:
  - `PORT=8000`
  - `PORT_HEALTH=8000`
  - `RUNPOD_VOLUME_PATH=/workspace`
  - `HF_TOKEN=<configured secret or env value>`
  - `BASE_MODEL_REPO=unsloth/Meta-Llama-3.1-8B-Instruct`
  - `BASE_MODEL_REVISION=a2856192dd7c25b842431f39c179a6c2c2f627d1`
  - `ADAPTER_REPO=AutoBot000/npc-sim-manual-llama31-local-check-20260421-025259-adapter`
  - `ADAPTER_REVISION=aa5c65b17f5ab9286f2f2c689cd66f0b0698606e`
  - `SERVED_BASE_MODEL=unsloth/Meta-Llama-3.1-8B-Instruct`
  - `SERVED_LORA_MODEL=npc-sim-manual-llama31-local-check-20260421-025259`
  - `MAX_MODEL_LEN=4096`
  - `GPU_MEMORY_UTILIZATION=0.90`
  - `ENABLE_LORA=true`
  - `MAX_LORAS=1`
  - `MAX_LORA_RANK=8`

## Test URL Shape

Load Balancer endpoints use the direct worker URL:

```text
https://<ENDPOINT_ID>.api.runpod.ai/v1/chat/completions
```

This is intentionally different from Runpod Hub vLLM queue endpoints:

```text
https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1/chat/completions
```
