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
  createRunpodLoadBalancerChatCompletion,
  createRunpodVllmRunSync,
  extractOpenAiCompatibleChatText,
  extractRunpodVllmText,
  getRunpodLoadBalancerPing,
  type RunpodEndpointMode,
} from "@server/runpod-client";
import {
  createTogetherChatCompletion,
  extractTogetherChatText,
} from "@server/together-client";

const FINAL_REPLY_REWRITE_TEMPERATURE = 0.2;
const RUNPOD_LOAD_BALANCER_RETRY_DELAY_MS = 5_000;
const RUNPOD_LOAD_BALANCER_INITIAL_ATTEMPT_TIMEOUT_MS = 30_000;
const RUNPOD_LOAD_BALANCER_READY_WAIT_SLICE_MS = 60_000;
const RUNPOD_LOAD_BALANCER_RETRYABLE_MESSAGES = [
  "Internal Server Error",
  "Runpod API request failed (500)",
  "Runpod load balancer is not ready",
  "All connection attempts failed",
  "fetch failed",
  "The operation was aborted",
  "This operation was aborted",
] as const;

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
    timeoutMs: appConfig.finalReply.timeoutMs,
  });
  return extractTogetherChatText(response) ?? "";
}

export async function runRunpodGenerate(params: {
  endpointId: string;
  endpointMode: RunpodEndpointMode;
  model: string;
  npcId: string;
  promptFormat: ScenePromptFormat;
  prompt: string;
}) {
  const messages = [
    {
      role: "system" as const,
      content: resolveSystemPrompt(params.npcId, params.promptFormat),
    },
    {
      role: "user" as const,
      content: params.prompt,
    },
  ];

  if (params.endpointMode === "load_balancer_vllm") {
    const response = await runRunpodLoadBalancerChatCompletionWithRetry({
      endpointId: params.endpointId,
      model: params.model,
      messages,
    });
    return extractOpenAiCompatibleChatText(response) ?? "";
  }

  const response = await createRunpodVllmRunSync({
    endpointId: params.endpointId,
    messages,
    maxTokens: appConfig.finalReply.maxTokens,
    temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
    timeoutMs: appConfig.finalReply.timeoutMs,
  });
  return extractRunpodVllmText(response) ?? "";
}

async function runRunpodLoadBalancerChatCompletionWithRetry(params: {
  endpointId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}) {
  const startedAt = Date.now();
  const deadline = startedAt + appConfig.finalReply.timeoutMs;
  let lastError: Error | null = null;
  let chatAttempts = 0;

  while (Date.now() < deadline) {
    try {
      if (chatAttempts > 0) {
        try {
          await waitForRunpodLoadBalancerReady({
            endpointId: params.endpointId,
            deadline: Math.min(
              deadline,
              Date.now() + RUNPOD_LOAD_BALANCER_READY_WAIT_SLICE_MS,
            ),
          });
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
      const remainingMs = Math.max(1_000, deadline - Date.now());
      return await createRunpodLoadBalancerChatCompletion({
        endpointId: params.endpointId,
        model: params.model,
        messages: params.messages,
        maxTokens: appConfig.finalReply.maxTokens,
        temperature: FINAL_REPLY_REWRITE_TEMPERATURE,
        timeoutMs:
          chatAttempts === 0
            ? Math.min(RUNPOD_LOAD_BALANCER_INITIAL_ATTEMPT_TIMEOUT_MS, remainingMs)
            : remainingMs,
      });
    } catch (error) {
      chatAttempts += 1;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetryableRunpodLoadBalancerError(lastError)) {
        throw lastError;
      }

      const retryDelayMs = Math.min(
        RUNPOD_LOAD_BALANCER_RETRY_DELAY_MS,
        Math.max(0, deadline - Date.now()),
      );
      if (retryDelayMs <= 0) {
        break;
      }
      await sleep(retryDelayMs);
    }
  }

  throw lastError ?? new Error("Runpod load balancer chat completion timed out.");
}

async function waitForRunpodLoadBalancerReady(params: {
  endpointId: string;
  deadline: number;
}) {
  let lastPing: Awaited<ReturnType<typeof getRunpodLoadBalancerPing>> | null = null;
  let lastError: Error | null = null;

  while (Date.now() < params.deadline) {
    try {
      lastPing = await getRunpodLoadBalancerPing(params.endpointId, {
        timeoutMs: Math.min(5_000, Math.max(1_000, params.deadline - Date.now())),
      });
      if (isRunpodLoadBalancerReadyPing(lastPing)) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    const retryDelayMs = Math.min(
      RUNPOD_LOAD_BALANCER_RETRY_DELAY_MS,
      Math.max(0, params.deadline - Date.now()),
    );
    if (retryDelayMs <= 0) {
      break;
    }
    await sleep(retryDelayMs);
  }

  const status = lastPing ? `last ping status=${lastPing.status}` : "no ping response";
  const text = lastPing?.text ? `; last ping body=${lastPing.text.slice(0, 120)}` : "";
  const error = lastError ? `; last error=${lastError.message}` : "";
  throw new Error(`Runpod load balancer is not ready: ${status}${text}${error}`);
}

function isRunpodLoadBalancerReadyPing(
  ping: Awaited<ReturnType<typeof getRunpodLoadBalancerPing>>,
) {
  if (!ping.ok) {
    return false;
  }

  const text = ping.text.trim();
  if (!text) {
    return false;
  }
  if (text === "ready") {
    return true;
  }

  try {
    const payload = JSON.parse(text) as { status?: unknown };
    return payload.status === "ok";
  } catch {
    return text.toLowerCase().includes("ok");
  }
}

function isRetryableRunpodLoadBalancerError(error: Error) {
  return RUNPOD_LOAD_BALANCER_RETRYABLE_MESSAGES.some((message) =>
    error.message.includes(message),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    timeoutMs: appConfig.finalReply.timeoutMs,
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
        signal: AbortSignal.timeout(appConfig.finalReply.timeoutMs),
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
