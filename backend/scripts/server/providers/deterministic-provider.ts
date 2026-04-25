import type {
  GenerateInteractionInput,
  LlmProvider,
} from "@backend-shared/provider-types";
import type {
  LlmInteractionResult,
} from "@backend-shared/api-contract-types";
import { buildFallbackInteractionResult } from "@server/engine/fallback-interaction";

export class DeterministicProvider implements LlmProvider {
  readonly mode = "deterministic" as const;

  async generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult> {
    return buildFallbackInteractionResult(input);
  }
}
