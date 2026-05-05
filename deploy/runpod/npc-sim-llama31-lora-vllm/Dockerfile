FROM vllm/vllm-openai:v0.7.3

USER root

RUN python3 -m pip install --no-cache-dir \
  "huggingface_hub>=0.24,<1" \
  "hf_transfer>=0.1.8,<1"

ENV HF_HUB_ENABLE_HF_TRANSFER=1 \
  TOKENIZERS_PARALLELISM=false \
  PORT=8000 \
  PORT_HEALTH=8000 \
  RUNPOD_VOLUME_PATH=/runpod-volume

WORKDIR /opt/npc-sim

COPY download_snapshot.py health_server.py prefill_server.py entrypoint.sh /opt/npc-sim/
COPY proxy_server.py /opt/npc-sim/
RUN chmod +x /opt/npc-sim/entrypoint.sh

EXPOSE 8000 8080

ENTRYPOINT ["/opt/npc-sim/entrypoint.sh"]
