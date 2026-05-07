import type {
  GenerateInteractionInput,
  LlmProvider,
} from "@backend-provider";
import type {
  LlmInteractionResult,
} from "@backend-contracts/api";
import { openAiConfig } from "@server/config/openai";
import { buildNpcInteractionMessages } from "@server/engine/intent";
import { createOpenAiResponse } from "@server/openai-responses-client";
import {
  llmInteractionSchema,
  NPC_INTERACTION_JSON_SCHEMA,
} from "@server/providers/llm-provider";
import { getInteractionModelCandidates } from "@server/providers/model-registry";

export class OpenAiProvider implements LlmProvider {
  readonly mode = "openai" as const;

  async generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult> {
    const apiKey = openAiConfig.apiKey;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER_MODE=openai.");
    }

    const { systemPrompt, userPrompt } = buildNpcInteractionMessages(input);
    let lastError: Error | null = null;

    for (const model of getInteractionModelCandidates()) {
      try {
        const generated = await createOpenAiResponse({
          stageName: "interaction",
          model,
          input: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          textFormat: {
            type: "json_schema",
            name: "npc_interaction",
            schema: NPC_INTERACTION_JSON_SCHEMA,
            strict: true,
          },
        });

        if (!generated.outputText) {
          throw new Error("OpenAI response did not include parseable output text.");
        }

        return llmInteractionSchema.parse(JSON.parse(generated.outputText)) as LlmInteractionResult;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error("OpenAI provider failed with an unknown error.");
      }
    }

    throw lastError ?? new Error("OpenAI provider failed without an error message.");
  }
}
