import { z } from "zod";
import { allowedActionTypes, emotionPrimaries, type LlmProvider } from "@/lib/types";
import { appConfig } from "@/server/config";
import { CodexProvider } from "@/server/providers/codex-provider";
import { OpenAiProvider } from "@/server/providers/openai-provider";

export const llmInteractionSchema = z.strictObject({
  reply: z.strictObject({
    text: z.string().min(1),
  }),
  emotion: z.strictObject({
    primary: z.enum(emotionPrimaries),
    intensity: z.number(),
    reason: z.string().min(1),
  }),
  intent: z.strictObject({
    summary: z.string().min(1),
    stance: z.string().min(1),
    leverage: z.string().min(1),
  }),
  candidateActions: z
    .array(
      z.strictObject({
        type: z.enum(allowedActionTypes),
        label: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .min(1)
    .max(3),
  selectedAction: z.strictObject({
    type: z.enum(allowedActionTypes),
    reason: z.string().min(1),
  }),
});

export const NPC_INTERACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
    },
    emotion: {
      type: "object",
      additionalProperties: false,
      properties: {
        primary: {
          type: "string",
          enum: [...emotionPrimaries],
        },
        intensity: { type: "number" },
        reason: { type: "string" },
      },
      required: ["primary", "intensity", "reason"],
    },
    intent: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        stance: { type: "string" },
        leverage: { type: "string" },
      },
      required: ["summary", "stance", "leverage"],
    },
    candidateActions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: [...allowedActionTypes],
          },
          label: { type: "string" },
          reason: { type: "string" },
        },
        required: ["type", "label", "reason"],
      },
    },
    selectedAction: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: [...allowedActionTypes],
        },
        reason: { type: "string" },
      },
      required: ["type", "reason"],
    },
  },
  required: ["reply", "emotion", "intent", "candidateActions", "selectedAction"],
} as const;

let codexProvider: CodexProvider | null = null;
let openAiProvider: OpenAiProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (appConfig.providerMode === "openai") {
    openAiProvider ??= new OpenAiProvider();
    return openAiProvider;
  }

  codexProvider ??= new CodexProvider();
  return codexProvider;
}
