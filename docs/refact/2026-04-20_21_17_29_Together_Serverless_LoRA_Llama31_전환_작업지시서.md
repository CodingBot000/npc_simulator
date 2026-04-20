# Together Serverless LoRA + Llama 3.1 Reference 전환 작업지시서

작성 시각: 2026-04-20 21:17:29

## 문서 목적

이 문서는 현재 `Qwen 로컬 학습/로컬 런타임` 중심 흐름에서,  
`dataset 재사용 + Together LoRA fine-tuning + serverless inference` 흐름으로 옮기기 위한 실행 문서다.

이 문서는 두 용도로 사용한다.

1. Codex가 실제 구현 순서와 누락 없는 수정 범위를 따라 개발하기 위한 작업지시서
2. 사람이 왜 `Qwen -> Llama 3.1 8B Instruct Reference`로 바꾸는지와, 어디까지가 최소 수정안인지 이해하기 위한 설명 문서

이 문서는 아이디어 메모가 아니다.  
이번 전환에서 무엇을 유지하고, 무엇을 새로 만들고, 무엇은 일부러 나중으로 미루는지까지 고정한다.

---

## 이번 작업의 핵심 결론

이번 작업의 핵심 결론은 아래 네 줄로 요약된다.

1. `Qwen/Qwen2.5-7B-Instruct`는 현재 Together의 `serverless LoRA` 경로와 맞지 않는다.
2. `Together serverless LoRA`를 쓰려면 `meta-llama/Meta-Llama-3.1-8B-Instruct-Reference` 같은 지원 base로 가야 한다.
3. 현재 review/finalize/golden dataset 파이프라인은 대부분 그대로 재사용할 수 있다.
4. 최소 수정안의 정답은 `로컬에서 adapter를 학습해서 업로드`가 아니라, `현재 dataset을 Together로 올리고 Together에서 LoRA fine-tuning job을 돌리는 경로`다.

즉 이번 작업은 본질적으로 다음 전환이다.

- 기존: `로컬 Qwen 학습 -> 로컬/수동 배포`
- 전환: `현재 dataset 재사용 -> Together Llama 3.1 Reference LoRA fine-tuning -> output_name으로 serverless 호출`

---

## 사실관계 정리

이번 문서의 전제 사실은 아래와 같다.

1. 현재 로컬 canonical base 기본값은 `Qwen/Qwen2.5-7B-Instruct`다.
   - 근거:
     - [ReviewService.java](/Users/switch/Development/Web/npc_simulator/backend/src/main/java/com/npcsimulator/review/ReviewService.java:101)
     - [training.ts](/Users/switch/Development/Web/npc_simulator/backend/scripts/review/training.ts:70)

2. 현재 로컬 runtime 기본값은 `mlx-community/Qwen2.5-7B-Instruct-4bit`다.
   - 근거:
     - [config.ts](/Users/switch/Development/Web/npc_simulator/backend/scripts/server/config.ts:46)

3. Together는 `fine-tuning 가능한 모델 목록`과 `serverless LoRA inference 가능한 base 목록`을 구분한다.
   - 공식 문서:
     - [Supported Models](https://docs.together.ai/docs/fine-tuning-models)
     - [LoRA Fine-Tuning and Inference](https://docs.together.ai/docs/lora-training-and-inference)

4. Together 공식 예시는 `meta-llama/Meta-Llama-3.1-8B-Instruct-Reference`를 `LoRA + serverless inference` 대상으로 든다.
   - 공식 문서:
     - [LoRA Fine-Tuning and Inference](https://docs.together.ai/docs/lora-training-and-inference)

5. 우리가 실제로 `Qwen/Qwen2.5-7B-Instruct` adapter 업로드를 시도했을 때 Together API가 `does not support LoRA adapters`로 거절했다.
   - 즉 문제는 로컬 adapter 파일이 아니라 `Together의 base 지원 정책`이다.

6. Together의 공식 serverless LoRA 경로는 `fine-tuning job이 완료되면 output_name으로 바로 호출`하는 방식이다.
   - 공식 문서:
     - [Deploying a Fine-tuned Model](https://docs.together.ai/docs/deploying-a-fine-tuned-model)
     - [Fine-tuning Guide](https://docs.together.ai/docs/finetuning)

7. Together 문서 기준 첫 요청은 adapter 로딩 때문에 더 느릴 수 있고, 보통 초기 cold start가 `5-10초` 수준일 수 있다.
   - 공식 문서:
     - [LoRA Fine-Tuning and Inference](https://docs.together.ai/docs/lora-training-and-inference)

중요:

- 이번 전환은 `완전 0초 응답`을 보장하려는 게 아니다.
- 목표는 `HF scale-to-zero 식 수십 초~수분 cold start`를 피하면서, `항상 켜짐 비용 없이` serverless LoRA를 쓰는 것이다.

---

## 이번 작업의 최종 목표

이번 작업이 끝나면 최소한 아래가 가능해야 한다.

1. 현재 review/finalize 파이프라인이 만든 SFT dataset을 재사용한다.
2. base model을 `meta-llama/Meta-Llama-3.1-8B-Instruct-Reference`로 바꾼다.
3. local PEFT 학습 대신 Together fine-tuning job을 생성한다.
4. job 완료 후 `output_name`을 저장한다.
5. AWS 서버든 로컬 서버든, Together API에 `output_name`을 넣어 바로 inference 한다.
6. 이 경로는 dedicated endpoint가 아니라 `serverless LoRA inference`여야 한다.

한 줄 요약:

- `dataset은 지금 것 재사용`
- `학습은 Together`
- `서빙은 Together serverless`
- `호출 키는 output_name`

---

## 비목표

이번 작업에서 일부러 하지 않을 것도 명확히 적는다.

1. `Qwen`을 Together serverless LoRA로 억지로 맞추는 작업은 하지 않는다.
2. `full fine-tuning + dedicated endpoint` 쪽으로 가지 않는다.
3. 기존 `PEFT 정본 + MLX 파생본` 로컬 개발 경로를 바로 삭제하지 않는다.
4. 첫 단계에서 DPO까지 한 번에 끝내는 것을 완료 조건으로 두지 않는다.
5. Together 배포 자동화 외의 다른 클라우드 벤더 동시 지원은 하지 않는다.

이번 문서의 최소 성공 기준은 `SFT dataset -> Together LoRA job -> serverless inference`다.

---

## 왜 최소 수정안이 로컬 학습 유지가 아닌가

겉으로 보면 이렇게 하고 싶어질 수 있다.

1. 로컬에서 Llama adapter를 학습한다.
2. 그 adapter를 Together에 업로드한다.
3. Together serverless로 쓴다.

하지만 이번 작업에서 이 경로를 기본값으로 잡지 않는다.

이유는 세 가지다.

1. Together 공식 문서상 가장 명확한 serverless LoRA 경로는 `Together 자체 fine-tuning -> output_name 바로 사용`이다.
2. `adapter 업로드` 문서는 dedicated endpoint 문맥이 섞여 있고, 실제 운영 안정성을 생각하면 원격 fine-tuning 쪽이 덜 애매하다.
3. 현재 목표는 `비용효율적인 serverless 운영`이지 `로컬 adapter portability`가 1순위가 아니다.

즉 이번 전환의 최소 수정안은 다음이 맞다.

- `local training pipeline replacement`
  가 아니라
- `dataset export pipeline reuse + remote fine-tuning backend 추가`

---

## 현재 구조에서 그대로 재사용할 것

이번 전환에서 아래 자산은 최대한 그대로 재사용한다.

### 1. 데이터 수집 / 검수 / finalize 흐름

아래 흐름은 유지한다.

1. raw data 수집
2. review
3. finalize
4. golden dataset 확정

즉 `데이터를 어떻게 모으고 정제하는가`는 이번 전환의 핵심 수정 대상이 아니다.

### 2. SFT dataset export 구조

현재 [export-mlx-sft-dataset.mjs](/Users/switch/Development/Web/npc_simulator/backend/scripts/export-mlx-sft-dataset.mjs)는 `messages` 배열을 가진 JSONL을 출력한다.

이 형식은 Together의 conversational fine-tuning 요구 형식과 거의 일치한다.

즉 다음은 거의 그대로 쓸 수 있다.

- `train.jsonl`
- `valid.jsonl`
- 각 line의 `messages`

주의:

- manifest의 `format: "mlx-lm-chat"` 표기는 Together 기준 이름이 아니므로, 문서/필드명만 중립적으로 정리하는 게 낫다.
- 하지만 실제 `train.jsonl`과 `valid.jsonl` 본문 구조는 재사용 가능하다.

### 3. review snapshot / fingerprint / run orchestration 뼈대

아래는 유지한다.

- dataset snapshot 선택
- fingerprint 계산
- preflight
- run 생성
- 상태 업데이트
- 로그/event append

즉 기존 `review training`이라는 기능 자체를 버리는 게 아니라, 그 안의 `학습 실행 백엔드`만 바꾸는 것이다.

---

## 현재 구조에서 새로 만들어야 할 것

최소 수정안에서 새로 필요한 것은 아래 다섯 가지다.

1. `Together remote fine-tuning backend`
2. `Together SFT dataset exporter 이름/책임 정리`
3. `remote job / output_name / file ids` 저장 필드
4. `serverless inference용 model_name`을 읽는 runtime 경로
5. `cloud training`과 `local training`을 구분하는 실행 모드

---

## 최소 수정안의 설계 결정

### 1. 기본 canonical training base를 Llama 3.1 Reference로 바꾼다

새 기본값:

- `CANONICAL_TRAINING_BASE_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct-Reference`

이 값은 로컬 실험용 임시값이 아니라, `Together serverless LoRA를 노리는 production training 기본값`이다.

주의:

- `local MLX runtime model`은 이 값과 분리한다.
- 즉 `canonical training base`와 `local runtime model`은 더 이상 같은 family일 필요가 없다.

### 2. 실행 모드를 명시적으로 나눈다

이번 작업에서는 학습 실행 방식을 명시적으로 나눈다.

권장 env:

- `TRAINING_EXECUTION_MODE=local_peft`
- `TRAINING_EXECUTION_MODE=together_serverless_lora`

기본 운영 목표는 `together_serverless_lora`다.

이 구분이 필요한 이유:

1. 로컬 실험과 클라우드 production을 같은 코드로 다루되
2. 로컬 artifact 중심 설계를 Together remote job에 억지로 끼워 맞추지 않기 위해서다.

### 3. SFT는 기존 exporter를 재사용한다

현재 [export-mlx-sft-dataset.mjs](/Users/switch/Development/Web/npc_simulator/backend/scripts/export-mlx-sft-dataset.mjs)는 실제 본문이 Together SFT 요구 형식과 잘 맞는다.

따라서 최소 수정안은 둘 중 하나다.

1. 파일명을 유지하고 내부 역할만 중립적으로 재정의
2. 같은 구현을 복사하지 않고 `export-together-sft-dataset.mjs` thin wrapper를 추가

권장안은 2번이다.

이유:

- 현재 이름에 `mlx`가 들어가 있어 사람을 혼동시킨다.
- 하지만 내부 로직은 이미 쓸 만하므로 중복 구현은 피하는 게 맞다.

### 4. DPO는 별도 phase로 뺀다

현재 [build-mlx-dpo-dataset.mjs](/Users/switch/Development/Web/npc_simulator/backend/scripts/build-mlx-dpo-dataset.mjs)는 다음 형식을 만든다.

- `promptMessages`
- `chosen`
- `rejected`

하지만 Together preference fine-tuning은 대체로 아래 형식을 기대한다.

- `input.messages`
- `preferred_output`
- `non_preferred_output`

즉 SFT와 달리 DPO는 `그대로 재사용`이 아니라 `포맷 변환`이 필요하다.

따라서 이번 최소 수정안에서는:

1. `SFT serverless LoRA cutover`를 먼저 끝낸다.
2. DPO는 `build-together-preference-dataset.mjs`를 추가하는 별도 단계로 뺀다.

### 5. Together model identity는 path가 아니라 remote id다

현재 구조는 `output_adapter_path`, `runtime_artifact_path` 같은 로컬 파일 경로 중심이다.

하지만 Together serverless LoRA에서 실제 서빙 키는 파일 경로가 아니라:

- `training_file_id`
- `validation_file_id`
- `job_id`
- `output_name`

이다.

따라서 Together mode에서는 아래를 별도 필드로 저장해야 한다.

권장 신규 필드:

- `training_backend`
- `remote_provider`
- `remote_job_id`
- `remote_training_file_id`
- `remote_validation_file_id`
- `remote_model_name`

여기서 가장 중요한 필드는 `remote_model_name`이다.  
이 값이 실제 Together inference 시 `model` 파라미터에 들어간다.

### 6. local artifact 필드는 Together mode에서 nullable이어야 한다

Together mode는 로컬 canonical adapter 디렉터리와 MLX runtime 디렉터리가 필수가 아니다.

따라서 아래를 억지로 채우면 안 된다.

- `output_adapter_path`
- `runtime_artifact_path`
- `runtime_artifact_kind`

정리:

- `local_peft` mode에서는 artifact path가 필수
- `together_serverless_lora` mode에서는 remote fields가 필수

---

## 목표 아키텍처

전환 후 최소 동작 구조는 아래와 같다.

1. review/finalize가 지금처럼 golden dataset을 만든다.
2. training preflight가 실행 모드를 확인한다.
3. `together_serverless_lora` mode면 SFT dataset을 Together용 JSONL로 만든다.
4. train/valid 파일을 Together Files에 업로드한다.
5. `meta-llama/Meta-Llama-3.1-8B-Instruct-Reference` base로 LoRA fine-tuning job을 만든다.
6. job 완료를 polling 한다.
7. 반환된 `output_name`을 training run metadata에 저장한다.
8. inference 시 AWS/로컬 서버는 `TOGETHER_API_KEY + remote_model_name`으로 바로 호출한다.

이 구조에서는 `deployment`라는 별도 단계가 거의 없다.

중요:

- serverless LoRA에서는 `output_name이 곧 배포 식별자`다.
- 즉 수동 반영은 본질적으로 `어떤 output_name을 현재 production model로 쓸지 바꾸는 일`이다.

---

## 단계별 실행 계획

## 0단계. 선행 정리

목적:

- `Qwen local artifact path`와 `Together remote model path`를 같은 개념으로 취급하지 않게 만든다.

필수 작업:

1. `TRAINING_EXECUTION_MODE` 개념 도입
2. `canonical base default`를 Llama Reference로 전환
3. Together serverless용 env 목록 정의

필수 env:

- `TRAINING_EXECUTION_MODE=together_serverless_lora`
- `CANONICAL_TRAINING_BASE_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct-Reference`
- `TOGETHER_API_KEY=...`

권장 추가 env:

- `TOGETHER_TRAINING_SUFFIX_PREFIX=npcsim`
- `TOGETHER_POLL_INTERVAL_MS=15000`
- `TOGETHER_TRAINING_N_EVALS=4`
- `TOGETHER_TRAIN_ON_INPUTS=false`

0단계 완료 조건:

1. 설정값만 봐도 local mode / together mode가 구분된다.
2. default base가 더 이상 Qwen이 아니다.

---

## 1단계. SFT dataset exporter를 Together 기준으로 정리

목적:

- 기존 exporter를 재사용하되, 이름과 의미를 `MLX 전용`에서 `중립적인 SFT conversational dataset`으로 정리한다.

필수 작업:

1. 새 wrapper 또는 rename
   - 권장 추가 파일:
     - `backend/scripts/export-together-sft-dataset.mjs`
2. 내부 구현은 가능하면 기존 [export-mlx-sft-dataset.mjs](/Users/switch/Development/Web/npc_simulator/backend/scripts/export-mlx-sft-dataset.mjs)를 재사용
3. manifest에 출력 포맷을 `together-conversational-jsonl` 같은 중립 명칭으로 남긴다

중요 원칙:

- SFT 데이터 본문은 최대한 그대로 둔다.
- 지금까지 만든 review/finalize 자산을 버리지 않는다.

1단계 완료 조건:

1. `train.jsonl`, `valid.jsonl`이 Together conversational dataset 검사에 통과한다.
2. 각 line은 `messages`만 포함하거나, Together가 무시 가능한 필드만 가진다.

---

## 2단계. Together remote fine-tuning worker 추가

목적:

- local python trainer 대신 Together fine-tuning API를 호출하는 실행 backend를 추가한다.

권장 신규 파일:

- `backend/scripts/review/together-finetune-worker.mjs`

이 worker가 해야 할 일:

1. train/valid JSONL 준비 확인
2. Together Files 업로드
3. fine-tuning job 생성
4. job polling
5. 성공 시 `output_name`, `job_id`, file ids를 결과 manifest에 기록
6. 실패 시 Together 에러 메시지를 training run log에 남김

권장 구현 방식:

- Node `fetch` 사용
- Together SDK를 필수 의존성으로 추가하지 않고 REST 호출로 끝낸다

이유:

- 현재 orchestrator가 Node/TS 중심이다.
- 최소 수정안에서는 의존성 추가를 줄이는 편이 낫다.

필수 저장 정보:

- `provider = together`
- `model_base = meta-llama/Meta-Llama-3.1-8B-Instruct-Reference`
- `training_file_id`
- `validation_file_id`
- `job_id`
- `output_name`
- `dashboard_url` 또는 조회용 링크 정보

2단계 완료 조건:

1. training run 하나가 Together에 실제 생성된다.
2. 로컬 DB/UI에서 `job_id`와 `output_name`을 볼 수 있다.
3. 성공 시 manifest 파일이 남는다.

---

## 3단계. DB / API / UI에 remote run 개념 추가

목적:

- 로컬 artifact 중심 training run view를 remote model 중심 view까지 확장한다.

필수 작업:

### DB

권장 신규 컬럼:

- `training_backend`
- `remote_provider`
- `remote_job_id`
- `remote_training_file_id`
- `remote_validation_file_id`
- `remote_model_name`

권장 migration:

- `backend/src/main/resources/db/migration/V6__add_remote_training_fields.sql`

### Java / Node read model

수정 대상:

- [ReviewRepository.java](/Users/switch/Development/Web/npc_simulator/backend/src/main/java/com/npcsimulator/review/ReviewRepository.java)
- [ReviewService.java](/Users/switch/Development/Web/npc_simulator/backend/src/main/java/com/npcsimulator/review/ReviewService.java)
- [review-db.ts](/Users/switch/Development/Web/npc_simulator/backend/scripts/server/db/review-db.ts)
- [review-types.ts](/Users/switch/Development/Web/npc_simulator/frontend/src/lib/review-types.ts)

### UI

수정 대상:

- [review-dashboard.tsx](/Users/switch/Development/Web/npc_simulator/frontend/src/components/review/review-dashboard.tsx)

표시해야 할 것:

1. execution mode
2. base model id
3. Together job id
4. Together output model name
5. training/validation file ids
6. local artifact 기반 run인지 remote run인지

3단계 완료 조건:

1. remote run을 경로 기반 artifact와 혼동하지 않는다.
2. output_name이 대시보드에서 바로 보인다.

---

## 4단계. training orchestration에 Together mode 연결

목적:

- 기존 [training.ts](/Users/switch/Development/Web/npc_simulator/backend/scripts/review/training.ts)와 [ReviewService.java](/Users/switch/Development/Web/npc_simulator/backend/src/main/java/com/npcsimulator/review/ReviewService.java)를 Together mode로 분기시킨다.

필수 작업:

1. `TRAINING_EXECUTION_MODE` 읽기
2. `local_peft`면 기존 로컬 경로 유지
3. `together_serverless_lora`면
   - dataset build
   - Together worker 실행
   - remote result 저장
4. preflight에 Together key / base model / dataset format 검사를 추가

preflight에서 막아야 할 것:

1. `TOGETHER_API_KEY` 없음
2. base model이 serverless LoRA 지원 모델이 아님
3. train/valid JSONL이 없음
4. validation을 쓰려는데 file 준비가 안 됨

4단계 완료 조건:

1. 학습 시작 버튼이 Together mode에서 실제 remote job을 만든다.
2. 실패 원인이 로컬 학습 스택이 아니라 Together API 응답으로 명확히 보인다.

---

## 5단계. runtime에서 promoted Together model 호출 가능하게 만들기

목적:

- 최종적으로 AWS든 로컬이든 `promoted remote_model_name`을 사용해 Together inference를 하게 만든다.

이번 단계의 핵심 질문:

- production runtime이 `MLX local provider`만 보는가?
- 아니면 `provider abstraction`을 통해 Together provider를 추가할 수 있는가?

최소 수정안 권장 방향:

1. `runtime provider`를 `mlx_local | together_remote` 둘로 분리
2. promoted binding이 local artifact가 아니라 `remote_model_name`을 가리킬 수 있게 함

권장 신규 파일:

- `backend/scripts/server/providers/together-reply.ts`

이 provider가 해야 할 일:

1. `TOGETHER_API_KEY` 읽기
2. promoted run의 `remote_model_name` 조회
3. Together `chat/completions` 호출
4. 기존 app 응답 포맷으로 normalize

중요:

- 이 단계가 끝나야 `수동 반영`이 실제로 `promoted remote model 전환`이 된다.
- 이 단계 전에는 training만 Together로 옮기고 runtime은 여전히 local일 수 있다.

5단계 완료 조건:

1. promoted run이 Together remote model이면 실제 runtime도 Together를 친다.
2. AWS 배포 서버에서도 같은 방식으로 동작한다.

---

## 6단계. SFT serverless smoke test

목적:

- end-to-end로 `dataset -> Together LoRA -> output_name -> inference`가 도는지 확인한다.

검증 시나리오:

1. final SFT dataset 기준 train/valid export
2. Together file upload 성공
3. fine-tuning job 성공
4. `output_name` 저장
5. 같은 `output_name`으로 chat completion 호출
6. 응답 1개 이상 수신

예상 호출 예시:

```bash
curl -X POST https://api.together.xyz/v1/chat/completions \
  -H "Authorization: Bearer $TOGETHER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-org/Meta-Llama-3.1-8B-Instruct-Reference-your-suffix",
    "messages": [
      {"role": "user", "content": "현장 안전 책임은 누구에게 있나?"}
    ],
    "max_tokens": 128
  }'
```

6단계 완료 조건:

1. 수동 명령이 아니라 시스템 안의 training run 결과로 inference까지 이어진다.
2. 초기 요청은 다소 느릴 수 있지만, HF cold boot처럼 장시간 대기는 없다.

---

## 7단계. DPO 후속 확장

이 단계는 최소 성공 이후에 진행한다.

목적:

- 현재 preference dataset을 Together preference fine-tuning 형식으로 변환하고, 같은 base에서 후속 학습으로 이어갈 수 있게 한다.

필수 작업:

1. 신규 exporter 추가
   - `backend/scripts/build-together-preference-dataset.mjs`
2. 현재 형식:
   - `promptMessages`
   - `chosen`
   - `rejected`
3. Together 형식으로 변환:
   - `input.messages`
   - `preferred_output`
   - `non_preferred_output`

중요 주의:

- DPO/Preference fine-tuning을 이어갈 때 Together의 `continued fine-tuning` 조건과 `LoRA serverless 유지 조건`을 확인해야 한다.
- 문서상 LoRA hyperparameter가 바뀌면 serverless LoRA가 비활성화될 수 있다.

따라서 DPO 단계의 원칙:

1. base model 동일 유지
2. LoRA method 유지
3. hyperparameter 변경 최소화

7단계 완료 조건:

1. SFT 이후 preference fine-tuning 실험이 가능하다.
2. output_name 기반 serverless inference가 유지되는지 별도 검증한다.

---

## 실제 수정 파일 목록

이번 최소 수정안에서 우선 수정 후보는 아래다.

### 필수

- [backend/scripts/review/training.ts](/Users/switch/Development/Web/npc_simulator/backend/scripts/review/training.ts)
- [backend/src/main/java/com/npcsimulator/review/ReviewService.java](/Users/switch/Development/Web/npc_simulator/backend/src/main/java/com/npcsimulator/review/ReviewService.java)
- [backend/src/main/java/com/npcsimulator/review/ReviewRepository.java](/Users/switch/Development/Web/npc_simulator/backend/src/main/java/com/npcsimulator/review/ReviewRepository.java)
- [backend/scripts/server/db/review-db.ts](/Users/switch/Development/Web/npc_simulator/backend/scripts/server/db/review-db.ts)
- [frontend/src/lib/review-types.ts](/Users/switch/Development/Web/npc_simulator/frontend/src/lib/review-types.ts)
- [frontend/src/components/review/review-dashboard.tsx](/Users/switch/Development/Web/npc_simulator/frontend/src/components/review/review-dashboard.tsx)

### 신규 추가 권장

- `backend/scripts/export-together-sft-dataset.mjs`
- `backend/scripts/review/together-finetune-worker.mjs`
- `backend/scripts/server/providers/together-reply.ts`
- `backend/src/main/resources/db/migration/V6__add_remote_training_fields.sql`

### 후속 확장

- `backend/scripts/build-together-preference-dataset.mjs`

---

## 완료 판정 기준

이번 작업은 아래가 모두 만족돼야 완료로 본다.

1. 기본 canonical training base가 `meta-llama/Meta-Llama-3.1-8B-Instruct-Reference`다.
2. training execution mode에 `together_serverless_lora`가 있다.
3. 현재 SFT dataset을 Together에 올릴 수 있다.
4. Together fine-tuning job을 시스템이 생성할 수 있다.
5. 성공 시 `remote_model_name(output_name)`이 DB/API/UI에 기록된다.
6. runtime이 promoted Together model을 실제로 호출할 수 있다.
7. 수동 반영은 `production에서 사용할 remote_model_name 변경`으로 수행 가능하다.

---

## 이번 작업의 리스크와 대응

### 리스크 1. 첫 요청 지연

문제:

- Together serverless LoRA도 첫 요청은 adapter load로 더 느릴 수 있다.

대응:

- HF scale-to-zero 수준의 장기 cold boot만 피하면 성공으로 본다.
- 운영 문서에는 `초기 1회 5-10초 가능`을 명시한다.

### 리스크 2. DPO 호환성

문제:

- 현재 DPO dataset 형식은 Together preference fine-tuning 형식과 다르다.

대응:

- SFT cutover를 먼저 끝내고 DPO는 별도 exporter로 분리한다.

### 리스크 3. local artifact 중심 설계와 remote run 설계 충돌

문제:

- 현 DB/UI는 경로 중심이다.

대응:

- remote id 필드를 명시적으로 추가한다.
- remote model을 path 컬럼에 우겨 넣지 않는다.

### 리스크 4. local MLX와 production base mismatch

문제:

- production base는 Llama 3.1, local runtime은 여전히 Qwen/MLX일 수 있다.

대응:

- 이번 문서에서는 이를 허용한다.
- local experimentation과 production serverless deployment는 같은 모델 패밀리일 필요가 없다고 본다.
- 다만 UI에서는 반드시 `local mode run`과 `together mode run`을 구분해서 보여준다.

---

## Codex 실행 순서 요약

Codex는 아래 순서로 개발한다.

1. `base model default`와 `execution mode`부터 바꾼다.
2. SFT exporter wrapper를 만든다.
3. Together fine-tuning worker를 추가한다.
4. remote metadata 필드를 migration/DB/API/UI에 추가한다.
5. training orchestration을 Together mode로 연결한다.
6. Together runtime provider를 추가한다.
7. 실제 SFT run 1회와 inference smoke test로 검증한다.
8. 그 다음에만 DPO exporter 작업으로 넘어간다.

이 순서를 바꾸지 않는다.

특히 아래는 금지한다.

1. DPO부터 먼저 붙이는 것
2. remote model name을 기존 artifact path 필드에 임시로 저장하는 것
3. local MLX 경로를 다 지우고 시작하는 것

---

## 사람이 이해해야 할 운영 포인트

이번 전환이 끝나면 운영자는 아래만 이해하면 된다.

1. 데이터 수집/검수/finalize 방식은 거의 그대로다.
2. 학습 base는 이제 `Qwen`이 아니라 `Llama 3.1 Reference`다.
3. 학습은 로컬 Python이 아니라 Together에서 돈다.
4. 서빙은 dedicated endpoint가 아니라 Together serverless model name으로 호출한다.
5. 새 모델 반영은 `새 output_name을 promotion`하는 일이다.

즉 운영 사고방식은 다음처럼 바뀐다.

- 이전: `adapter 디렉터리를 어디에 둘까`
- 이후: `이번 run의 Together output_name이 무엇이고, 지금 production이 어느 output_name을 보고 있나`

---

## 참고 문서

- [Together Fine-tuning Guide](https://docs.together.ai/docs/finetuning)
- [Together Supported Models](https://docs.together.ai/docs/fine-tuning-models)
- [Together LoRA Fine-Tuning and Inference](https://docs.together.ai/docs/lora-training-and-inference)
- [Together Deploying a Fine-tuned Model](https://docs.together.ai/docs/deploying-a-fine-tuned-model)
- [Together Pricing](https://www.together.ai/pricing)
- [Together Data Preparation](https://docs.together.ai/docs/fine-tuning-data-preparation)

