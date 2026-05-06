# RunPod vLLM Deployment Configuration Snapshot

조회 일시: 2026-05-07 KST

이 문서는 RunPod API로 확인한 serverless vLLM 배포 설정을 이력서/포트폴리오 설명용으로 요약한 것이다. API key, HF token, endpoint 전체 URL, secret env 값은 포함하지 않는다.

## 목적

- Llama 3.1 8B Instruct 기반 LoRA 모델을 RunPod Serverless Load Balancer endpoint로 서빙한다.
- 애플리케이션은 최종 대사 rewrite 단계에서 RunPod vLLM을 primary backend로 호출한다.
- RunPod timeout 또는 worker health 실패 시 OpenAI fallback으로 응답 안정성을 유지한다.

## Endpoint Summary

| 항목 | 확인값 |
| --- | --- |
| Endpoint name | `npc-sim-llama31-lora-custom-vllm-lb` |
| Endpoint kind | Load Balancer vLLM endpoint |
| Endpoint id | masked, `vllm...v0pin2` |
| Template id | masked, `vllm...0yez` |
| Network volume id | masked, `2uaa...c722w` |
| Serverless template | enabled |
| Container image | public ECR vLLM image, tag `20260505-194515` |
| Container disk | `30 GB` |
| Volume mount path | `/workspace` |

## Scaling And Availability

| 항목 | 확인값 |
| --- | --- |
| Active/min workers | `0` |
| Max workers | `3` |
| GPU count per worker | `1` |
| Scaling policy | request count |
| Scaler value | `1` |
| Idle timeout | `60 seconds` |
| Execution timeout | `180,000 ms` |
| FlashBoot | enabled |

이 설정은 비용을 줄이기 위해 always-on worker를 두지 않고, 요청이 들어올 때 최대 3개 worker까지 확장할 수 있게 만든 구성이다. 면접관 검수와 개발자 테스트가 겹치는 상황을 고려해 `Max workers=3`으로 worker headroom을 확보했다.

## GPU Candidate Pool

RunPod API 응답 기준으로 현재 endpoint에는 아래 GPU SKU 후보가 설정되어 있다.

| 용도 | GPU 후보 |
| --- | --- |
| 80 GB class | `NVIDIA A100 80GB PCIe`, `NVIDIA A100-SXM4-80GB` |
| 48 GB class | `NVIDIA RTX 6000 Ada Generation`, `NVIDIA L40`, `NVIDIA L40S` |
| 96 GB class | `NVIDIA RTX PRO 6000 Blackwell Server Edition`, `NVIDIA RTX PRO 6000 Blackwell Workstation Edition`, `NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition` |

RunPod 콘솔의 GPU class 선택은 API 응답에서 여러 실제 GPU SKU로 확장되어 보인다. 이 후보 풀은 단일 GPU type의 supply shortage로 worker provisioning이 막히는 상황을 줄이기 위한 설정이다.

## Runtime Environment Shape

Template env 값은 문서화하지 않는다. API로 확인한 env key 범위는 아래와 같다.

| 분류 | env key |
| --- | --- |
| model source | `BASE_MODEL_REPO`, `BASE_MODEL_REVISION`, `ADAPTER_REPO`, `ADAPTER_REVISION` |
| LoRA/vLLM | `ENABLE_LORA`, `SERVED_BASE_MODEL`, `SERVED_LORA_MODEL`, `MAX_LORAS`, `MAX_LORA_RANK`, `MAX_MODEL_LEN`, `GPU_MEMORY_UTILIZATION` |
| storage/cache | `RUNPOD_VOLUME_PATH`, `HF_HUB_ENABLE_HF_TRANSFER`, `TOKENIZERS_PARALLELISM` |
| runtime | `PYTHONUNBUFFERED` |
| health/serving port keys | `PORT`, `PORT_HEALTH` |
| secret | `HF_TOKEN` |

`HF_TOKEN` 값은 RunPod template env에 존재하지만, 이 문서에는 값이나 token prefix를 기록하지 않는다.

## Application Binding

애플리케이션 backend는 RunPod를 다음 역할로 사용한다.

| 항목 | 값 |
| --- | --- |
| Final reply backend | `runpod` |
| Endpoint mode | `load_balancer_vllm` |
| Served model role | final reply rewrite |
| Request timeout policy | short single request, OpenAI fallback on timeout |
| Failure diagnostics | `/ping` and `/v1/models` status check after rewrite failure |

## Operational Notes

- `Active/min workers=0`이므로 대기 중 고정 GPU 과금은 발생하지 않는다.
- `Max workers=3`은 worker 상한이며, 요청이 없을 때 3개가 항상 실행되는 설정이 아니다.
- `FlashBoot`는 cold start 시간을 줄이기 위한 설정이며, 별도 secret이나 application code change가 아니다.
- GPU 후보를 여러 개 둔 이유는 RunPod supply shortage 상황에서 endpoint provisioning 성공률을 높이기 위해서다.
- `/ping`과 `/v1/models`가 동시에 timeout이면 애플리케이션 prompt/rewrite 코드 문제가 아니라 RunPod load balancer 또는 worker health 문제로 판정한다.

## Security Boundary

Public 문서에 남기지 않는 항목:

- RunPod API key
- HF token
- endpoint 전체 URL
- endpoint id 전체값
- network volume id 전체값
- template env 값
- private registry credential

Public 문서에 남기는 항목:

- scaling 정책
- worker 수
- GPU 후보 class/SKU
- timeout/FlashBoot 여부
- image/runtime 형태
- 장애 진단 방식
