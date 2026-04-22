import { getServerEnv } from "@server/config";

const DEFAULT_RUNPOD_REST_API_BASE_URL = "https://rest.runpod.io/v1";
const DEFAULT_RUNPOD_SERVERLESS_API_BASE_URL = "https://api.runpod.ai/v2";

type RawRecord = Record<string, unknown>;

type OpenAiCompatibleChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<RawRecord>;
    };
    text?: string;
  }>;
};

type RunpodNativeVllmResponse = {
  id?: string | null;
  status?: string | null;
  workerId?: string | null;
  output?: unknown;
  error?: string | null;
};

export interface RunpodTemplateRecord {
  id: string;
  name?: string | null;
  imageName?: string | null;
  env?: Record<string, string> | null;
  isServerless?: boolean | null;
  isRunpod?: boolean | null;
}

export interface RunpodEndpointRecord {
  id: string;
  name?: string | null;
  templateId?: string | null;
  env?: Record<string, string> | null;
  gpuTypeIds?: string[] | null;
  workersMin?: number | null;
  workersMax?: number | null;
  idleTimeout?: number | null;
  flashboot?: boolean | null;
}

export interface RunpodEndpointHealth {
  jobs?: Record<string, number> | null;
  workers?: Record<string, number> | null;
}

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
    const errorRecord =
      record.error && typeof record.error === "object" ? (record.error as RawRecord) : null;
    const nestedMessage = trimToNull(
      errorRecord && typeof errorRecord.message === "string" ? errorRecord.message : null,
    );
    if (nestedMessage) {
      return nestedMessage;
    }
  }
  return fallback;
}

function runpodRestApiBaseUrl() {
  return trimToNull(getServerEnv("RUNPOD_REST_API_BASE_URL")) ?? DEFAULT_RUNPOD_REST_API_BASE_URL;
}

function runpodServerlessApiBaseUrl() {
  return (
    trimToNull(getServerEnv("RUNPOD_SERVERLESS_API_BASE_URL")) ??
    DEFAULT_RUNPOD_SERVERLESS_API_BASE_URL
  );
}

export function getRunpodApiKey() {
  return getServerEnv("RUNPOD_API_KEY");
}

function buildHeaders(apiKey: string, init?: RequestInit) {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(init?.headers ?? {}),
  };
}

async function runpodJsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const apiKey = getRunpodApiKey();
  if (!apiKey) {
    throw new Error("RUNPOD_API_KEY is required.");
  }

  const response = await fetch(url, {
    ...init,
    headers: buildHeaders(apiKey, init),
  });

  const rawText = await response.text();
  const payload = rawText ? (JSON.parse(rawText) as unknown) : null;
  if (!response.ok) {
    throw new Error(normalizeErrorMessage(payload, `Runpod API request failed (${response.status}).`));
  }
  return payload as T;
}

function normalizeListResponse<T>(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === "object") {
    const data = (payload as RawRecord).data;
    if (Array.isArray(data)) {
      return data as T[];
    }
  }
  return [] as T[];
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function asStringRecord(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function normalizeTemplateRecord(payload: unknown): RunpodTemplateRecord | null {
  const record = asRecord(payload);
  const id = trimToNull(typeof record?.id === "string" ? record.id : null);
  if (!id) {
    return null;
  }

  return {
    id,
    name: trimToNull(typeof record?.name === "string" ? record.name : null),
    imageName: trimToNull(typeof record?.imageName === "string" ? record.imageName : null),
    env: asStringRecord(record?.env),
    isServerless:
      typeof record?.isServerless === "boolean" ? record.isServerless : null,
    isRunpod: typeof record?.isRunpod === "boolean" ? record.isRunpod : null,
  };
}

function normalizeEndpointRecord(payload: unknown): RunpodEndpointRecord | null {
  const record = asRecord(payload);
  const id = trimToNull(typeof record?.id === "string" ? record.id : null);
  if (!id) {
    return null;
  }

  const nestedTemplate = asRecord(record.template);
  const templateId =
    trimToNull(typeof record.templateId === "string" ? record.templateId : null) ??
    trimToNull(typeof nestedTemplate?.id === "string" ? nestedTemplate.id : null);

  return {
    id,
    name: trimToNull(typeof record.name === "string" ? record.name : null),
    templateId,
    env: asStringRecord(record.env),
    gpuTypeIds: asStringArray(record.gpuTypeIds),
    workersMin: typeof record.workersMin === "number" ? record.workersMin : null,
    workersMax: typeof record.workersMax === "number" ? record.workersMax : null,
    idleTimeout: typeof record.idleTimeout === "number" ? record.idleTimeout : null,
    flashboot: typeof record.flashboot === "boolean" ? record.flashboot : null,
  };
}

export function buildRunpodOpenAiBaseUrl(endpointId: string) {
  const trimmed = trimToNull(endpointId);
  if (!trimmed) {
    throw new Error("Runpod endpointId is required.");
  }
  return `${runpodServerlessApiBaseUrl()}/${trimmed}/openai/v1`;
}

function buildRunpodServerlessBaseUrl(endpointId: string) {
  const trimmed = trimToNull(endpointId);
  if (!trimmed) {
    throw new Error("Runpod endpointId is required.");
  }
  return `${runpodServerlessApiBaseUrl()}/${trimmed}`;
}

export async function listRunpodTemplates() {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodRestApiBaseUrl()}/templates?includeRunpodTemplates=true&includeEndpointBoundTemplates=true`,
    {
      method: "GET",
    },
  );
  return normalizeListResponse<unknown>(payload)
    .map((entry) => normalizeTemplateRecord(entry))
    .filter((entry): entry is RunpodTemplateRecord => Boolean(entry));
}

export async function findRunpodTemplateByName(name: string) {
  const templates = await listRunpodTemplates();
  const targetName = trimToNull(name);
  return templates.find((entry) => trimToNull(entry.name) === targetName) ?? null;
}

export async function createRunpodTemplate(params: {
  name: string;
  imageName: string;
  env?: Record<string, string>;
  containerDiskInGb?: number;
  isPublic?: boolean;
  ports?: string[];
  readme?: string;
}) {
  const payload = await runpodJsonRequest<unknown>(`${runpodRestApiBaseUrl()}/templates`, {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      imageName: params.imageName,
      env: params.env ?? {},
      category: "NVIDIA",
      containerDiskInGb: params.containerDiskInGb ?? 50,
      isPublic: params.isPublic ?? false,
      isServerless: true,
      ports: params.ports ?? [],
      readme: params.readme ?? "",
    }),
  });
  const record = normalizeTemplateRecord(payload);
  if (!record) {
    throw new Error("Runpod template create response missing template id.");
  }
  return record;
}

export async function updateRunpodTemplate(
  templateId: string,
  params: {
    name?: string;
    imageName?: string;
    env?: Record<string, string>;
    containerDiskInGb?: number;
    isPublic?: boolean;
    ports?: string[];
    readme?: string;
  },
) {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodRestApiBaseUrl()}/templates/${encodeURIComponent(templateId)}/update`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(params.name ? { name: params.name } : {}),
        ...(params.imageName ? { imageName: params.imageName } : {}),
        ...(params.env ? { env: params.env } : {}),
        ...(params.containerDiskInGb != null
          ? { containerDiskInGb: params.containerDiskInGb }
          : {}),
        ...(params.isPublic != null ? { isPublic: params.isPublic } : {}),
        ...(params.ports ? { ports: params.ports } : {}),
        ...(params.readme != null ? { readme: params.readme } : {}),
        isServerless: true,
      }),
    },
  );
  const record = normalizeTemplateRecord(payload);
  if (!record) {
    throw new Error("Runpod template update response missing template id.");
  }
  return record;
}

export async function listRunpodEndpoints() {
  const payload = await runpodJsonRequest<unknown>(`${runpodRestApiBaseUrl()}/endpoints`, {
    method: "GET",
  });
  return normalizeListResponse<unknown>(payload)
    .map((entry) => normalizeEndpointRecord(entry))
    .filter((entry): entry is RunpodEndpointRecord => Boolean(entry));
}

export async function findRunpodEndpointByName(name: string) {
  const endpoints = await listRunpodEndpoints();
  const targetName = trimToNull(name);
  return endpoints.find((entry) => trimToNull(entry.name) === targetName) ?? null;
}

export async function getRunpodEndpoint(endpointId: string) {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodRestApiBaseUrl()}/endpoints/${encodeURIComponent(endpointId)}`,
    {
      method: "GET",
    },
  );
  return normalizeEndpointRecord(payload);
}

export async function createRunpodEndpoint(params: {
  name: string;
  templateId: string;
  gpuTypeIds: string[];
  gpuCount?: number;
  workersMin?: number;
  workersMax?: number;
  idleTimeout?: number;
  executionTimeoutMs?: number;
  flashboot?: boolean;
  scalerType?: "QUEUE_DELAY" | "REQUEST_COUNT";
  scalerValue?: number;
}) {
  const payload = await runpodJsonRequest<unknown>(`${runpodRestApiBaseUrl()}/endpoints`, {
    method: "POST",
    body: JSON.stringify({
      templateId: params.templateId,
      name: params.name,
      computeType: "GPU",
      gpuTypeIds: params.gpuTypeIds,
      gpuCount: params.gpuCount ?? 1,
      workersMin: params.workersMin ?? 0,
      workersMax: params.workersMax ?? 1,
      idleTimeout: params.idleTimeout ?? 5,
      executionTimeoutMs: params.executionTimeoutMs ?? 600_000,
      flashboot: params.flashboot ?? true,
      scalerType: params.scalerType ?? "QUEUE_DELAY",
      scalerValue: params.scalerValue ?? 4,
    }),
  });
  const record = normalizeEndpointRecord(payload);
  if (!record) {
    throw new Error("Runpod endpoint create response missing endpoint id.");
  }
  return record;
}

export async function updateRunpodEndpoint(
  endpointId: string,
  params: {
    name?: string;
    templateId?: string;
    gpuTypeIds?: string[];
    gpuCount?: number;
    workersMin?: number;
    workersMax?: number;
    idleTimeout?: number;
    executionTimeoutMs?: number;
    flashboot?: boolean;
    scalerType?: "QUEUE_DELAY" | "REQUEST_COUNT";
    scalerValue?: number;
  },
) {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodRestApiBaseUrl()}/endpoints/${encodeURIComponent(endpointId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...(params.name ? { name: params.name } : {}),
        ...(params.templateId ? { templateId: params.templateId } : {}),
        ...(params.gpuTypeIds ? { gpuTypeIds: params.gpuTypeIds } : {}),
        ...(params.gpuCount != null ? { gpuCount: params.gpuCount } : {}),
        ...(params.workersMin != null ? { workersMin: params.workersMin } : {}),
        ...(params.workersMax != null ? { workersMax: params.workersMax } : {}),
        ...(params.idleTimeout != null ? { idleTimeout: params.idleTimeout } : {}),
        ...(params.executionTimeoutMs != null
          ? { executionTimeoutMs: params.executionTimeoutMs }
          : {}),
        ...(params.flashboot != null ? { flashboot: params.flashboot } : {}),
        ...(params.scalerType ? { scalerType: params.scalerType } : {}),
        ...(params.scalerValue != null ? { scalerValue: params.scalerValue } : {}),
      }),
    },
  );
  const record = normalizeEndpointRecord(payload);
  if (!record) {
    throw new Error("Runpod endpoint update response missing endpoint id.");
  }
  return record;
}

export async function deleteRunpodEndpoint(endpointId: string) {
  return runpodJsonRequest<unknown>(
    `${runpodRestApiBaseUrl()}/endpoints/${encodeURIComponent(endpointId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function getRunpodEndpointHealth(endpointId: string) {
  return runpodJsonRequest<RunpodEndpointHealth>(
    `${buildRunpodServerlessBaseUrl(endpointId)}/health`,
    {
      method: "GET",
    },
  );
}

export async function listRunpodOpenAiModels(endpointId: string) {
  return runpodJsonRequest<{ data?: Array<{ id?: string | null }> }>(
    `${buildRunpodOpenAiBaseUrl(endpointId)}/models`,
    {
      method: "GET",
    },
  );
}

export async function createRunpodVllmRunSync(params: {
  endpointId: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
}) {
  const input: RawRecord = {
    sampling_params: {
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 160,
    },
  };
  if (params.messages?.length) {
    input.messages = params.messages;
  } else if (trimToNull(params.prompt)) {
    input.prompt = params.prompt;
  } else {
    throw new Error("Runpod runsync requires messages or prompt.");
  }

  return runpodJsonRequest<RunpodNativeVllmResponse>(
    `${buildRunpodServerlessBaseUrl(params.endpointId)}/runsync`,
    {
      method: "POST",
      body: JSON.stringify({ input }),
    },
  );
}

export async function createRunpodOpenAiChatCompletion(params: {
  endpointId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
}) {
  return runpodJsonRequest<OpenAiCompatibleChatResponse>(
    `${buildRunpodOpenAiBaseUrl(params.endpointId)}/chat/completions`,
    {
      method: "POST",
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens ?? 160,
        temperature: params.temperature ?? 0.7,
      }),
    },
  );
}

export function extractOpenAiCompatibleChatText(response: OpenAiCompatibleChatResponse) {
  const firstChoice = response.choices?.[0];
  const messageContent = firstChoice?.message?.content;
  if (typeof messageContent === "string") {
    return trimToNull(messageContent);
  }
  if (Array.isArray(messageContent)) {
    const textParts = messageContent
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        return trimToNull(typeof entry.text === "string" ? entry.text : null);
      })
      .filter((value): value is string => Boolean(value));
    return trimToNull(textParts.join("\n"));
  }
  return trimToNull(firstChoice?.text);
}

function extractRunpodChoiceText(choice: unknown) {
  const record = asRecord(choice);
  const directText = trimToNull(typeof record?.text === "string" ? record.text : null);
  if (directText) {
    return directText;
  }

  const tokens = Array.isArray(record?.tokens)
    ? record.tokens.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (tokens.length > 0) {
    return trimToNull(tokens.join(""));
  }

  const message = asRecord(record?.message);
  const content = message?.content;
  if (typeof content === "string") {
    return trimToNull(content);
  }
  if (Array.isArray(content)) {
    const textParts = content
      .map((entry) => {
        const item = asRecord(entry);
        return trimToNull(typeof item?.text === "string" ? item.text : null);
      })
      .filter((value): value is string => Boolean(value));
    return trimToNull(textParts.join("\n"));
  }

  return null;
}

export function extractRunpodVllmText(response: RunpodNativeVllmResponse) {
  const output = response.output;
  if (typeof output === "string") {
    return trimToNull(output);
  }

  const outputEntries = Array.isArray(output) ? output : [output];
  for (const entry of outputEntries) {
    const record = asRecord(entry);
    const directText = trimToNull(typeof record?.text === "string" ? record.text : null);
    if (directText) {
      return directText;
    }

    const choices = Array.isArray(record?.choices) ? record.choices : [];
    for (const choice of choices) {
      const choiceText = extractRunpodChoiceText(choice);
      if (choiceText) {
        return choiceText;
      }
    }
  }

  return null;
}
