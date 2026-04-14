import type {
  GenerateInteractionInput,
  LlmInteractionResult,
  RuntimeStatus,
} from "@/lib/types";
import { buildNpcInteractionMessages } from "@/server/engine/intent";
import {
  llmInteractionSchema,
  NPC_INTERACTION_JSON_SCHEMA,
} from "@/server/providers/llm-provider";
import { getInteractionModelCandidates } from "@/server/providers/model-registry";

export class OpenAiProvider {
  readonly mode = "openai" as const;

  async getStatus(): Promise<RuntimeStatus> {
    const configured = Boolean(process.env.OPENAI_API_KEY);

    return {
      providerMode: "openai",
      configured,
      label: configured ? "OpenAI Responses 사용 가능" : "OPENAI_API_KEY 필요",
      detail: configured
        ? "OPENAI_API_KEY가 감지되었습니다."
        : "OPENAI_API_KEY를 설정하면 openai 모드로 전환할 수 있습니다.",
    };
  }

  async generateInteraction(
    input: GenerateInteractionInput,
  ): Promise<LlmInteractionResult> {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER_MODE=openai.");
    }

    const { systemPrompt, userPrompt } = buildNpcInteractionMessages(input);
    let lastError: Error | null = null;

    for (const model of getInteractionModelCandidates()) {
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
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
            text: {
              format: {
                type: "json_schema",
                name: "npc_interaction",
                schema: NPC_INTERACTION_JSON_SCHEMA,
                strict: true,
              },
            },
          }),
        });

        const payload = (await response.json()) as {
          error?: { message?: string };
          output_text?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error?.message || "OpenAI response request failed.");
        }

        const outputText = payload.output_text;

        if (!outputText) {
          throw new Error("OpenAI response did not include output_text.");
        }

        return llmInteractionSchema.parse(JSON.parse(outputText));
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
