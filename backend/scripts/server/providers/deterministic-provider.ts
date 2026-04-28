import type {
  GenerateInteractionInput,
  LlmProvider,
} from "@backend-provider";
import type {
  LlmInteractionResult,
} from "@backend-contracts/api";
import { buildFallbackInteractionResult } from "@server/engine/fallback-interaction";

export class DeterministicProvider implements LlmProvider {
  readonly mode = "deterministic" as const;

  async generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult> {
    return buildFallbackInteractionResult(input);
  }
}
