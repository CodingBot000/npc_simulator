FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir "huggingface_hub>=0.24,<1"

ENV TOKENIZERS_PARALLELISM=false \
  PORT=8000 \
  PORT_HEALTH=8000 \
  RUNPOD_VOLUME_PATH=/workspace \
  PREFILL_ONLY=true \
  PYTHONUNBUFFERED=1

WORKDIR /opt/npc-sim

COPY npc-sim-llama31-lora-vllm/download_snapshot.py /opt/npc-sim/
COPY npc-sim-llama31-lora-vllm/prefill_server.py /opt/npc-sim/
COPY npc-sim-llama31-lora-vllm/entrypoint.sh /opt/npc-sim/
RUN chmod +x /opt/npc-sim/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/opt/npc-sim/entrypoint.sh"]
