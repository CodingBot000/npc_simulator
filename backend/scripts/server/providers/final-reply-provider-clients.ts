import { spawn } from "node:child_process";
import {
  buildCodexCliChildEnv,
  buildModelExecutionChildEnv,
} from "@backend-support/bootstrap";
import { PROJECT_ROOT, appConfig } from "@server/config";
import { openAiConfig } from "@server/config/openai";
import {
  createBasetenChatCompletion,
  extractBasetenChatText,
} from "@server/baseten-client";
import { LOCAL_MLX_BINARY } from "@server/providers/mlx-reply-config";
import {
  resolveSystemPrompt,
  type ScenePromptFormat,
} from "@server/providers/mlx-reply-prompts";
import { extractDelimitedText } from "@server/providers/mlx-reply-text-utils";
import {
  createRunpodVllmRunSync,
  extractRunpodVllmText,
} from "@server/runpod-client";
import {
  createTogetherChatCompletion,
  extractTogetherChatText,
} from "@server/together-client";

const FINAL_REPLY_REWRITE_TEMPERATURE = 0.2;

interface OpenAiTextResponsePayload {
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

export async function runMlxGenerate(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(LOCAL_MLX_BINARY, args, {
      cwd: PROJECT_ROOT,
      env: buildModelExecutionChildEnv(PROJECT_ROOT),
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
      resolve(extractDelimitedText(stdout || stderr));
    });
  });
}

export async function runTogetherGenerate(params: {
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const response = await createTogetherChatCompletion({
    model: params.model,
    messages: [
      {
        role: "system",
        content: resolveSystemPrompt(params.npcId, params.promptFormat),
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
    maxTokens: appConfig.finalReply.maxTokens,
    temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
  });
  return extractTogetherChatText(response) ?? "";
}

export async function runRunpodGenerate(params: {
  endpointId: string;
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const response = await createRunpodVllmRunSync({
    endpointId: params.endpointId,
    messages: [
      {
        role: "system",
        content: resolveSystemPrompt(params.npcId, params.promptFormat),
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
    maxTokens: appConfig.finalReply.maxTokens,
    temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
  });
  return extractRunpodVllmText(response) ?? "";
}

export async function runBasetenGenerate(params: {
  modelId: string;
  modelUrl: string | null;
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const response = await createBasetenChatCompletion({
    modelId: params.modelId,
    modelUrl: params.modelUrl,
    model: params.model,
    messages: [
      {
        role: "system",
        content: resolveSystemPrompt(params.npcId, params.promptFormat),
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
    maxTokens: appConfig.finalReply.maxTokens,
    temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
  });
  return extractBasetenChatText(response) ?? "";
}

export async function runCodexGenerate(params: {
  models: string[];
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}): Promise<{ text: string; model: string }> {
  let lastError: Error | null = null;

  for (const model of params.models) {
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          "codex",
          [
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--dangerously-bypass-approvals-and-sandbox",
            "-C",
            PROJECT_ROOT,
            "-m",
            model,
            "-",
          ],
          {
            cwd: PROJECT_ROOT,
            env: buildCodexCliChildEnv(PROJECT_ROOT),
            stdio: ["pipe", "pipe", "pipe"],
          },
        );

        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`codex exec timed out after 120000ms for model=${model}`));
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
            reject(
              new Error(
                stderr.trim() || stdout.trim() || `codex exec failed for model=${model}.`,
              ),
            );
            return;
          }
          resolve(stdout.trim());
        });

        child.stdin.write(
          `${resolveSystemPrompt(params.npcId, params.promptFormat)}\n\n${params.prompt}`,
        );
        child.stdin.end();
      });

      if (text) {
        return { text, model };
      }

      lastError = new Error(`codex reply output was empty for model=${model}.`);
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("Codex final reply generation failed.");
    }
  }

  throw lastError ?? new Error("Codex final reply generation failed.");
}

export async function runOpenAiGenerate(params: {
  models: string[];
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}): Promise<{ text: string; model: string }> {
  const apiKey = openAiConfig.apiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when FINAL_REPLY_BACKEND=openai_api.");
  }

  let lastError: Error | null = null;

  for (const model of params.models) {
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
              content: resolveSystemPrompt(params.npcId, params.promptFormat),
            },
            {
              role: "user",
              content: params.prompt,
            },
          ],
          max_output_tokens: appConfig.finalReply.maxTokens,
        }),
      });

      const payload = (await response.json()) as OpenAiTextResponsePayload;
      if (!response.ok) {
        throw new Error(payload.error?.message || `OpenAI response request failed for model=${model}.`);
      }

      const outputText = extractOpenAiOutputText(payload);
      if (outputText) {
        return { text: outputText, model };
      }

      lastError = new Error(`OpenAI final reply output was empty for model=${model}.`);
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("OpenAI final reply generation failed.");
    }
  }

  throw lastError ?? new Error("OpenAI final reply generation failed.");
}

export function isBaseten400RequestError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Baseten inference request failed (400)")
  );
}

function extractOpenAiOutputText(payload: OpenAiTextResponsePayload) {
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
