import { basetenServiceConfig } from "@server/config/baseten-service";

type RawRecord = Record<string, unknown>;

export type BasetenAutoscalingSettings = {
  min_replica: number;
  max_replica: number;
  autoscaling_window: number;
  scale_down_delay: number;
  concurrency_target: number;
  target_utilization_percentage: number;
};

export type BasetenDeployment = RawRecord & {
  id?: string;
  status?: string;
  is_production?: boolean;
  active_replica_count?: number;
  autoscaling_settings?: BasetenAutoscalingSettings;
};

export type BasetenChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<RawRecord>;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
  } | string;
};

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as RawRecord;
    const directMessage = trimToNull(typeof record.message === "string" ? record.message : null);
    if (directMessage) {
      return directMessage;
    }
    const directError = trimToNull(typeof record.error === "string" ? record.error : null);
    if (directError) {
      return directError;
    }
    const errorRecord =
      record.error && typeof record.error === "object" ? (record.error as RawRecord) : null;
    const nestedMessage = trimToNull(
      errorRecord && typeof errorRecord.message === "string" ? errorRecord.message : null,
    );
    if (nestedMessage) {
      return nestedMessage;
    }
    const detail = trimToNull(typeof record.detail === "string" ? record.detail : null);
    if (detail) {
      return detail;
    }
  }
  return fallback;
}

async function parseJsonResponse(response: Response) {
  const rawText = await response.text();
  if (!rawText) {
    return null;
  }
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return { message: rawText };
  }
}

export async function basetenManagementJsonRequest<T>(
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const apiKey = basetenServiceConfig.apiKey;
  if (!apiKey) {
    throw new Error("BASETEN_API_KEY is required.");
  }

  const response = await fetch(`${basetenServiceConfig.apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      normalizeErrorMessage(payload, `Baseten API request failed (${response.status}).`),
    );
  }
  return payload as T;
}

export async function upsertBasetenSecret(params: {
  name: string;
  value: string;
}) {
  return basetenManagementJsonRequest<RawRecord>("/v1/secrets", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      value: params.value,
    }),
  });
}

export async function listBasetenModels() {
  return basetenManagementJsonRequest<unknown>("/v1/models", {
    method: "GET",
  });
}

export async function getBasetenDeployment(params: {
  modelId: string;
  deploymentId: string;
}) {
  return basetenManagementJsonRequest<BasetenDeployment>(
    `/v1/models/${params.modelId}/deployments/${params.deploymentId}`,
    {
      method: "GET",
    },
  );
}

export async function updateBasetenDeploymentAutoscaling(params: {
  modelId: string;
  deploymentId: string;
  settings: BasetenAutoscalingSettings;
}) {
  return basetenManagementJsonRequest<RawRecord>(
    `/v1/models/${params.modelId}/deployments/${params.deploymentId}/autoscaling_settings`,
    {
      method: "PATCH",
      body: JSON.stringify(params.settings),
    },
  );
}

function resolveBasetenOpenAiBaseUrl(params: {
  modelId?: string | null;
  modelUrl?: string | null;
}) {
  const explicitUrl = trimToNull(params.modelUrl);
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/u, "");
  }
  const modelId = trimToNull(params.modelId ?? basetenServiceConfig.modelId);
  if (!modelId) {
    throw new Error("Baseten model ID is required.");
  }
  return `https://model-${modelId}.api.baseten.co/environments/production/sync/v1`;
}

export async function createBasetenChatCompletion(params: {
  modelId?: string | null;
  modelUrl?: string | null;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) {
  const apiKey = basetenServiceConfig.apiKey;
  if (!apiKey) {
    throw new Error("BASETEN_API_KEY is required.");
  }

  const baseUrl = resolveBasetenOpenAiBaseUrl(params);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens ?? 160,
      temperature: params.temperature ?? 0.7,
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 15 * 60_000),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const detail = normalizeErrorMessage(payload, "");
    throw new Error(
      detail
        ? `Baseten inference request failed (${response.status}): ${detail}`
        : `Baseten inference request failed (${response.status}).`,
    );
  }
  return payload as BasetenChatResponse;
}

export function extractBasetenChatText(response: BasetenChatResponse) {
  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") {
    return trimToNull(content);
  }
  if (Array.isArray(content)) {
    return trimToNull(
      content
        .map((entry) => {
          if (typeof entry.text === "string") {
            return entry.text;
          }
          if (typeof entry.content === "string") {
            return entry.content;
          }
          return "";
        })
        .join(""),
    );
  }
  return trimToNull(choice?.text ?? null);
}
