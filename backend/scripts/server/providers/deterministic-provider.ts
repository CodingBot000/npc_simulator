import type {
  GenerateInteractionInput,
  LlmInteractionResult,
} from "@backend-shared/types";
import { buildFallbackInteractionResult } from "@server/engine/fallback-interaction";

export class DeterministicProvider {
  readonly mode = "deterministic" as const;

  async generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult> {
    return buildFallbackInteractionResult(input);
  }
}
