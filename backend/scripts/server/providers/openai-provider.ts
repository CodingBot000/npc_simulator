import type {
  GenerateInteractionInput,
  LlmProvider,
} from "@backend-provider";
import type {
  LlmInteractionResult,
} from "@backend-contracts/api";
import { openAiConfig } from "@server/config/openai";
import { buildNpcInteractionMessages } from "@server/engine/intent";
import {
  llmInteractionSchema,
  NPC_INTERACTION_JSON_SCHEMA,
} from "@server/providers/llm-provider";
import { getInteractionModelCandidates } from "@server/providers/model-registry";

interface OpenAiResponsesPayload {
  error?: { message?: string };
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

function extractOutputText(payload: OpenAiResponsesPayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const textChunks =
    payload.output
      ?.flatMap((entry) => entry.content ?? [])
      .filter((entry) => entry.type === "output_text" && typeof entry.text === "string")
      .map((entry) => entry.text!.trim())
      .filter(Boolean) ?? [];

  return textChunks.join("\n").trim();
}

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

        const payload = (await response.json()) as OpenAiResponsesPayload;

        if (!response.ok) {
          throw new Error(payload.error?.message || "OpenAI response request failed.");
        }

        const outputText = extractOutputText(payload);

        if (!outputText) {
          throw new Error("OpenAI response did not include parseable output text.");
        }

        return llmInteractionSchema.parse(JSON.parse(outputText)) as LlmInteractionResult;
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
