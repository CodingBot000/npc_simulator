import type {
  GenerateInteractionInput,
  LlmInteractionResult,
  RuntimeStatus,
} from "@/lib/types";
import { buildFallbackInteractionResult } from "@/server/engine/fallback-interaction";

export class DeterministicProvider {
  readonly mode = "deterministic" as const;

  async getStatus(): Promise<RuntimeStatus> {
    return {
      providerMode: "deterministic",
      configured: true,
      label: "Deterministic fallback 활성화",
      detail: "외부 모델 호출 없이 규칙 기반 반응으로 스모크와 통합 검증을 수행합니다.",
    };
  }

  async generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult> {
    return buildFallbackInteractionResult(input);
  }
}
