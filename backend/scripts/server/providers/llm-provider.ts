import { z } from "zod";
import {
  type RuntimeStatus,
} from "@backend-contracts/api";
import type { LlmProvider } from "@backend-provider";
import {
  allowedActionTypes,
  emotionPrimaries,
  impactTags,
} from "@sim-shared/type-sets";
import { appConfig, hasServerEnv } from "@server/config";
import { CodexProvider } from "@server/providers/codex-provider";
import { DeterministicProvider } from "@server/providers/deterministic-provider";
import { OpenAiProvider } from "@server/providers/openai-provider";

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
  structuredImpact: z.strictObject({
    impactTags: z.array(z.enum(impactTags)).min(1).max(5),
    targetNpcId: z.string().min(1).nullable(),
    confidence: z.number(),
    rationale: z.string().min(1),
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
    structuredImpact: {
      type: "object",
      additionalProperties: false,
      properties: {
        impactTags: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "string",
            enum: [...impactTags],
          },
        },
        targetNpcId: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        confidence: { type: "number" },
        rationale: { type: "string" },
      },
      required: ["impactTags", "targetNpcId", "confidence", "rationale"],
    },
  },
  required: [
    "reply",
    "emotion",
    "intent",
    "candidateActions",
    "selectedAction",
    "structuredImpact",
  ],
} as const;

let codexProvider: CodexProvider | null = null;
let openAiProvider: OpenAiProvider | null = null;
let deterministicProvider: DeterministicProvider | null = null;

export function buildRuntimeStatus(): RuntimeStatus {
  if (appConfig.providerMode === "openai") {
    const configured = hasServerEnv("OPENAI_API_KEY");

    return {
      providerMode: "openai",
      configured,
      label: configured ? "OpenAI Responses 사용 가능" : "OPENAI_API_KEY 필요",
      detail: configured
        ? "OPENAI_API_KEY가 감지되었습니다."
        : "OPENAI_API_KEY를 설정하면 openai 모드로 전환할 수 있습니다.",
    };
  }

  if (appConfig.providerMode === "deterministic") {
    return {
      providerMode: "deterministic",
      configured: true,
      label: "Deterministic fallback 활성화",
      detail: "외부 모델 호출 없이 규칙 기반 반응으로 스모크와 통합 검증을 수행합니다.",
    };
  }

  return {
    providerMode: "codex",
    configured: true,
    label: "Codex CLI 사용",
    detail: "실시간 login status 확인 없이 Codex 실행 경로를 바로 사용합니다.",
  };
}

export function getLlmProvider(): LlmProvider {
  if (appConfig.providerMode === "openai") {
    openAiProvider ??= new OpenAiProvider();
    return openAiProvider;
  }

  if (appConfig.providerMode === "deterministic") {
    deterministicProvider ??= new DeterministicProvider();
    return deterministicProvider;
  }

  codexProvider ??= new CodexProvider();
  return codexProvider;
}
