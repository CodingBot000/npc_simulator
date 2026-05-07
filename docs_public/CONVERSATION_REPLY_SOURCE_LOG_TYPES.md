# Conversation Reply Source Log Types

이 문서는 `방 안 대화` 섹션의 대화방 디버그 표기가 어떤 의미인지 설명한다. 목적은 포트폴리오/이력서에서 vLLM serving 경로, fallback 처리, 장애 진단 로그를 공개 가능한 수준으로 설명하기 위한 것이다.

## Purpose

대화방의 provider 로그는 최종 NPC 대사가 어느 backend에서 생성되었는지와, vLLM serving 실패 시 어떤 fallback 경로가 동작했는지를 보여준다.

이 로그는 일반 플레이 UX 설명이 아니라 운영 관측성(observability)과 장애 대응 설계 설명용이다.

## Display Format

대화방의 NPC 메시지 하단에는 디버그가 켜진 경우 다음 형태의 source label이 붙는다.

```text
remote · runpod · llama
remote · openai · gpt-nano · runpod→openai
```

각 segment의 의미는 다음과 같다.

| Segment | 의미 |
| --- | --- |
| `remote` | 로컬 런타임이 아니라 외부 inference/provider API를 통해 최종 rewrite가 처리됨 |
| `local` | 로컬 모델 런타임으로 처리됨 |
| `runpod` | RunPod Serverless Load Balancer vLLM endpoint를 사용함 |
| `openai` | OpenAI API fallback rewrite를 사용함 |
| `llama` | Llama 계열 vLLM/LoRA 모델 경로에서 응답이 생성됨 |
| `gpt-nano` | GPT-5 nano 계열 OpenAI fallback 모델에서 응답이 생성됨 |
| `runpod→openai` | RunPod vLLM primary 경로가 실패했고, OpenAI fallback으로 최종 대사를 복구함 |

`gpt-nano`는 UI 표시용 모델 계열 label이다. 실제 호출 모델은 환경 변수와 backend 설정에 의해 관리되며, 운영 환경에서는 같은 계열의 cost/latency 최적화 모델로 교체할 수 있다.

## Success Case

```text
remote · runpod · llama
```

이 표기는 최종 NPC 대사 rewrite가 RunPod의 vLLM endpoint에서 성공했다는 뜻이다.

운영 관점에서 이 케이스는 다음을 증명한다.

- Llama 3.1 기반 fine-tuned/LoRA 모델이 vLLM OpenAI-compatible serving 경로로 호출됨
- 애플리케이션 backend가 RunPod endpoint에 prompt를 전달하고 응답을 수신함
- 최종 대사 검증을 통과한 rewrite 후보가 실제 대화방에 반영됨

이력서/포트폴리오 설명 예시:

```text
대화 응답의 최종 rewrite 단계를 RunPod Serverless vLLM endpoint에 연결하고, 성공 시 `remote · runpod · llama` 로그로 실제 vLLM serving 경로를 사용자/검토자가 확인할 수 있도록 구성했습니다.
```

## Failure And Fallback Case

```text
remote · openai · gpt-nano · runpod→openai
```

이 표기는 RunPod vLLM primary 경로가 timeout, worker health failure, endpoint unavailable 등으로 실패했지만, 앱 전체 응답을 중단하지 않고 OpenAI fallback rewrite로 최종 대사를 복구했다는 뜻이다.

운영 관점에서 이 케이스는 다음을 보여준다.

- primary serving backend는 RunPod vLLM임
- vLLM 호출 실패가 감지됨
- 실패를 사용자 응답 실패로 방치하지 않고 fallback provider로 degrade함
- fallback 발생 사실을 숨기지 않고 source label에 명시함

이력서/포트폴리오 설명 예시:

```text
RunPod vLLM endpoint가 unavailable 또는 timeout 상태일 때는 OpenAI fallback으로 응답을 복구하되, `runpod→openai` source label을 남겨 primary vLLM serving 실패와 fallback 경로를 명확히 추적할 수 있게 했습니다.
```

## Failure Detail Log

RunPod rewrite가 실패하면 대화방 디버그와 `턴 처리 기록` 팝업에 실패 상세 로그가 표시된다.

기록 대상은 다음과 같다.

| 항목 | 의미 |
| --- | --- |
| `prompt` length | RunPod에 전달한 rewrite prompt 크기 |
| `system` / `user` length | OpenAI-compatible chat message별 입력 크기 |
| `max_tokens` | rewrite 요청의 최대 출력 token 제한 |
| `endpoint` / `mode` / `model` | 호출한 RunPod endpoint mode와 served model 식별 정보 |
| `attempts` | rewrite 요청 시도 횟수 |
| attempt duration | 각 요청이 timeout 또는 실패까지 걸린 시간 |
| failure reason | fetch timeout, HTTP error, aborted request 등 실제 실패 원인 |
| `/ping` health check | RunPod worker 또는 load balancer가 HTTP health 응답을 주는지 확인 |
| `/v1/models` model check | vLLM OpenAI-compatible model list endpoint가 정상 응답하는지 확인 |

이 로그의 목적은 다음 원인을 구분하는 것이다.

- prompt가 너무 커져서 generation이 느려진 경우
- 모델 자체 generation latency가 긴 경우
- RunPod worker가 cold start, busy, unavailable, throttled 상태인 경우
- load balancer 또는 worker health endpoint가 응답하지 않는 경우
- client retry/timeout 정책이 문제를 키우는 경우

## Interpretation Rules

`remote · runpod · llama`가 보이면 vLLM serving 성공으로 본다.

`remote · openai · gpt-nano · runpod→openai`가 보이면 앱은 정상적으로 응답을 복구했지만, 해당 turn의 primary RunPod vLLM serving은 실패한 것으로 본다.

RunPod 실패 상세 로그에서 `/ping`과 `/v1/models`가 모두 timeout이면, prompt/rewrite 코드보다 RunPod load balancer 또는 worker availability 문제가 더 유력하다.

RunPod 실패 상세 로그에서 `/ping`은 성공하고 `/v1/models`만 실패하면, worker는 떠 있지만 vLLM server readiness 또는 model loading 문제가 의심된다.

RunPod 실패 상세 로그에서 health check는 성공했는데 rewrite만 timeout이면, prompt 크기, max token 설정, vLLM generation latency, batching 상태를 우선 점검한다.

## Public Safety

이 로그와 문서는 운영 설명용으로 endpoint 전체 URL, API key, HF token, secret env value를 포함하지 않는다. 공개 가능한 source label과 masked endpoint/model 정보만 사용한다.
