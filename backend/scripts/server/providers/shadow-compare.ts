import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  allowedActionTypes,
  emotionPrimaries,
  impactTags,
  type GenerateInteractionInput,
  type LlmInteractionResult,
  type RuntimeArtifactKind,
  type ShadowComparisonPayload,
  type ShadowComparisonStatus,
} from "@backend-shared/types";
import { safeJsonParse, stripCodeFence } from "@backend-shared/utils";
import { PROJECT_ROOT, appConfig } from "@server/config";
import { normalizeLlmInteractionResult } from "@server/engine/action-selection";
import { buildNpcInteractionMessages } from "@server/engine/intent";
import {
  llmInteractionSchema,
  NPC_INTERACTION_JSON_SCHEMA,
} from "@server/providers/llm-provider";

const LOCAL_MLX_BINARY = path.join(PROJECT_ROOT, ".venv", "bin", "mlx_lm.generate");

let binaryCheckPromise: Promise<boolean> | null = null;
const runtimeAvailability = new Map<string, Promise<boolean>>();

function buildSourceRef(artifactKind: RuntimeArtifactKind, artifactPath: string) {
  if (artifactKind === "mlx_fused_model") {
    return artifactPath;
  }

  return `${appConfig.shadowCompare.mlxModel} + ${artifactPath}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function extractDelimitedText(output: string) {
  const matches = [...String(output).matchAll(/==========\n([\s\S]*?)\n==========/g)];
  return matches.at(-1)?.[1]?.trim() ?? "";
}

function extractFirstJsonObject(value: string) {
  const source = String(value ?? "");
  const start = source.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasMlxBinary() {
  if (!binaryCheckPromise) {
    binaryCheckPromise = fileExists(LOCAL_MLX_BINARY);
  }

  return binaryCheckPromise;
}

async function hasRuntimeArtifact(
  artifactPath: string,
  artifactKind: RuntimeArtifactKind,
) {
  const cacheKey = `${artifactKind}:${artifactPath}`;

  if (!runtimeAvailability.has(cacheKey)) {
    runtimeAvailability.set(
      cacheKey,
      artifactKind === "mlx_fused_model"
        ? fileExists(artifactPath)
        : fileExists(path.join(artifactPath, "adapters.safetensors")),
    );
  }

  return runtimeAvailability.get(cacheKey) ?? Promise.resolve(false);
}

function buildShadowPrompt(input: GenerateInteractionInput) {
  const { systemPrompt, userPrompt } = buildNpcInteractionMessages(input);
  const allowedTargetNpcIds = uniqueStrings(
    input.consensusBoard
      .map((entry) => entry.candidateId)
      .filter((candidateId) => candidateId !== "player"),
  );
  const outputTemplate = {
    reply: {
      text: "한국어 NPC 대사",
    },
    emotion: {
      primary: emotionPrimaries[0],
      intensity: 50,
      reason: "감정 근거",
    },
    intent: {
      summary: "이번 턴의 목적",
      stance: "상대에 대한 태도",
      leverage: "지금 활용하는 근거",
    },
    candidateActions: [
      {
        type: allowedActionTypes[0],
        label: "행동 라벨",
        reason: "이 행동을 검토하는 이유",
      },
      {
        type: allowedActionTypes[1],
        label: "행동 라벨",
        reason: "대안 행동을 검토하는 이유",
      },
    ],
    selectedAction: {
      type: allowedActionTypes[0],
      reason: "최종 선택 이유",
    },
    structuredImpact: {
      impactTags: [impactTags[0]],
      targetNpcId: allowedTargetNpcIds[0] ?? null,
      confidence: 70,
      rationale: "게임 상태에 미치는 영향 설명",
    },
  };
  const instructions = [
    "You are a strict JSON generator for a game NPC turn.",
    systemPrompt,
    "Return exactly one valid JSON object and nothing else.",
    "Start with { and end with }.",
    "Use double quotes for every key and string value.",
    "Do not use single quotes, comments, markdown fences, bullet lists, prose, or trailing commas.",
    "Do not output Python dict syntax.",
    "Fill every required field even when uncertain.",
    "Write reply.text in natural Korean and keep it to 1-3 sentences.",
    `emotion.primary must be one of: ${emotionPrimaries.join(", ")}.`,
    `candidateActions.type and selectedAction.type must be one of: ${allowedActionTypes.join(", ")}.`,
    "candidateActions must contain 2 or 3 distinct action types.",
    "selectedAction.type must match one candidateActions.type exactly.",
    `structuredImpact.impactTags must be chosen from: ${impactTags.join(", ")}.`,
    `structuredImpact.targetNpcId must be one of: ${allowedTargetNpcIds.join(", ") || "null"} or null.`,
    "emotion.intensity and structuredImpact.confidence must be integers from 0 to 100.",
  ];

  return {
    systemPrompt: instructions.join(" "),
    prompt: [
      "Output shape example:",
      JSON.stringify(outputTemplate, null, 2),
      "",
      "Exact JSON schema to satisfy:",
      JSON.stringify(NPC_INTERACTION_JSON_SCHEMA, null, 2),
      "",
      "Interaction input:",
      userPrompt,
      "",
      "Return only one JSON object that satisfies the schema.",
    ].join("\n"),
  };
}

async function runMlxGenerate(params: {
  artifactKind: RuntimeArtifactKind;
  artifactPath: string;
  maxTokens: number;
  prompt: string;
  systemPrompt: string;
}) {
  const args =
    params.artifactKind === "mlx_fused_model"
      ? [
          "--model",
          params.artifactPath,
          "--system-prompt",
          params.systemPrompt,
          "--prompt",
          params.prompt,
          "--prefill-response",
          "{",
          "--max-tokens",
          String(params.maxTokens),
          "--temp",
          "0.0",
          "--top-p",
          "1.0",
          "--seed",
          "7",
          "--verbose",
          "False",
        ]
      : [
          "--model",
          appConfig.shadowCompare.mlxModel,
          "--adapter-path",
          params.artifactPath,
          "--system-prompt",
          params.systemPrompt,
          "--prompt",
          params.prompt,
          "--prefill-response",
          "{",
          "--max-tokens",
          String(params.maxTokens),
          "--temp",
          "0.0",
          "--top-p",
          "1.0",
          "--seed",
          "7",
          "--verbose",
          "False",
        ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(LOCAL_MLX_BINARY, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("mlx_lm.generate timed out after 120000ms."));
    }, 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || "mlx_lm.generate failed."));
        return;
      }

      const extracted = extractDelimitedText(stdout || stderr);
      resolve(extracted || stdout.trim() || stderr.trim());
    });
  });
}

function parseShadowOutput(rawOutput: string): {
  error: string | null;
  result: LlmInteractionResult | null;
  status: ShadowComparisonStatus;
} {
  const normalized = stripCodeFence(rawOutput);
  const prefixed =
    normalized.startsWith("{") ||
    (!normalized.startsWith('"') && !normalized.startsWith("'"))
      ? normalized
      : `{${normalized}}`;
  const directParsed = safeJsonParse<unknown>(prefixed);
  const extractedJson = directParsed ? null : extractFirstJsonObject(prefixed);
  const fallbackParsed = extractedJson ? safeJsonParse<unknown>(extractedJson) : null;
  const parsed = directParsed ?? fallbackParsed;

  if (!parsed) {
    return {
      status: "invalid_json",
      result: null,
      error: "Shadow model did not return valid JSON.",
    };
  }

  try {
    return {
      status: "parsed",
      result: normalizeLlmInteractionResult(
        llmInteractionSchema.parse(parsed) as LlmInteractionResult,
      ),
      error: null,
    };
  } catch (error) {
    return {
      status: "invalid_json",
      result: null,
      error: error instanceof Error ? error.message : "Schema validation failed.",
    };
  }
}

export async function maybeGenerateShadowComparison(
  input: GenerateInteractionInput,
): Promise<ShadowComparisonPayload | null> {
  if (!appConfig.shadowCompare.enabled) {
    return null;
  }

  const startedAt = Date.now();
  const artifactPath = appConfig.shadowCompare.artifactPath;
  const artifactKind = appConfig.shadowCompare.artifactKind;
  const sourceRef = buildSourceRef(artifactKind, artifactPath);
  const basePayload = {
    label: appConfig.shadowCompare.label,
    mode: "local_mlx" as const,
    artifactKind,
    sourceRef,
  };

  if (!(await hasMlxBinary())) {
    return {
      ...basePayload,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: `MLX binary not found: ${LOCAL_MLX_BINARY}`,
      rawOutput: null,
      result: null,
    };
  }

  if (!(await hasRuntimeArtifact(artifactPath, artifactKind))) {
    return {
      ...basePayload,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: `Runtime artifact not found: ${artifactPath}`,
      rawOutput: null,
      result: null,
    };
  }

  try {
    const { systemPrompt, prompt } = buildShadowPrompt(input);
    const rawOutput = await runMlxGenerate({
      artifactKind,
      artifactPath,
      maxTokens: appConfig.shadowCompare.maxTokens,
      prompt,
      systemPrompt,
    });
    const parsed = parseShadowOutput(rawOutput);

    return {
      ...basePayload,
      status: parsed.status,
      durationMs: Date.now() - startedAt,
      error: parsed.error,
      rawOutput: parsed.status === "parsed" ? null : rawOutput,
      result: parsed.result,
    };
  } catch (error) {
    return {
      ...basePayload,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      rawOutput: null,
      result: null,
    };
  }
}
