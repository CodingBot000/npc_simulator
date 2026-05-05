import { runpodServiceConfig } from "@server/config/runpod-service";

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

export type RunpodEndpointMode = "queue_vllm" | "load_balancer_vllm";

export interface RunpodTemplateRecord {
  id: string;
  name?: string | null;
  imageName?: string | null;
  env?: Record<string, string> | null;
  isServerless?: boolean | null;
  isRunpod?: boolean | null;
  ports?: string[] | null;
  volumeMountPath?: string | null;
}

export interface RunpodEndpointRecord {
  id: string;
  name?: string | null;
  templateId?: string | null;
  env?: Record<string, string> | null;
  gpuTypeIds?: string[] | null;
  dataCenterIds?: string[] | null;
  networkVolumeId?: string | null;
  networkVolumeIds?: string[] | null;
  workersMin?: number | null;
  workersMax?: number | null;
  idleTimeout?: number | null;
  flashboot?: boolean | null;
}

export interface RunpodContainerRegistryAuthRecord {
  id: string;
  name?: string | null;
}

export interface RunpodNetworkVolumeRecord {
  id: string;
  name?: string | null;
  size?: number | null;
  dataCenterId?: string | null;
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

export function getRunpodApiKey() {
  return runpodServiceConfig.apiKey;
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
  let payload: unknown = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = { message: rawText };
    }
  }
  if (!response.ok) {
    throw new Error(normalizeErrorMessage(payload, `Runpod API request failed (${response.status}).`));
  }
  return payload as T;
}

async function runpodGraphqlRequest<T>(operationName: string, query: string, variables?: RawRecord) {
  const payload = await runpodJsonRequest<{
    data?: T;
    errors?: Array<{ message?: string | null }>;
  }>(`https://api.runpod.io/graphql?operation=${encodeURIComponent(operationName)}`, {
    method: "POST",
    body: JSON.stringify({
      query,
      variables: variables ?? {},
    }),
  });

  if (payload.errors?.length) {
    const messages = payload.errors
      .map((entry) => trimToNull(entry.message ?? null))
      .filter(Boolean)
      .join("; ");
    throw new Error(messages || `Runpod GraphQL ${operationName} failed.`);
  }
  if (!payload.data) {
    throw new Error(`Runpod GraphQL ${operationName} response missing data.`);
  }
  return payload.data;
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
    ports: asStringArray(record?.ports),
    volumeMountPath: trimToNull(
      typeof record?.volumeMountPath === "string" ? record.volumeMountPath : null,
    ),
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
    dataCenterIds: asStringArray(record.dataCenterIds),
    networkVolumeId: trimToNull(
      typeof record.networkVolumeId === "string" ? record.networkVolumeId : null,
    ),
    networkVolumeIds: asStringArray(record.networkVolumeIds),
    workersMin: typeof record.workersMin === "number" ? record.workersMin : null,
    workersMax: typeof record.workersMax === "number" ? record.workersMax : null,
    idleTimeout: typeof record.idleTimeout === "number" ? record.idleTimeout : null,
    flashboot: typeof record.flashboot === "boolean" ? record.flashboot : null,
  };
}

function normalizeNetworkVolumeRecord(payload: unknown): RunpodNetworkVolumeRecord | null {
  const record = asRecord(payload);
  const id = trimToNull(typeof record?.id === "string" ? record.id : null);
  if (!id) {
    return null;
  }

  return {
    id,
    name: trimToNull(typeof record?.name === "string" ? record.name : null),
    size: typeof record?.size === "number" ? record.size : null,
    dataCenterId: trimToNull(
      typeof record?.dataCenterId === "string" ? record.dataCenterId : null,
    ),
  };
}

function normalizeContainerRegistryAuthRecord(
  payload: unknown,
): RunpodContainerRegistryAuthRecord | null {
  const record = asRecord(payload);
  const id = trimToNull(typeof record?.id === "string" ? record.id : null);
  if (!id) {
    return null;
  }

  return {
    id,
    name: trimToNull(typeof record?.name === "string" ? record.name : null),
  };
}

export function buildRunpodOpenAiBaseUrl(endpointId: string) {
  const trimmed = trimToNull(endpointId);
  if (!trimmed) {
    throw new Error("Runpod endpointId is required.");
  }
  return `${runpodServiceConfig.serverlessApiBaseUrl}/${trimmed}/openai/v1`;
}

export function buildRunpodLoadBalancerBaseUrl(endpointId: string) {
  const trimmed = trimToNull(endpointId);
  if (!trimmed) {
    throw new Error("Runpod endpointId is required.");
  }
  return `https://${trimmed}.api.runpod.ai`;
}

function buildRunpodServerlessBaseUrl(endpointId: string) {
  const trimmed = trimToNull(endpointId);
  if (!trimmed) {
    throw new Error("Runpod endpointId is required.");
  }
  return `${runpodServiceConfig.serverlessApiBaseUrl}/${trimmed}`;
}

export async function listRunpodTemplates() {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodServiceConfig.restApiBaseUrl}/templates?includeRunpodTemplates=true&includeEndpointBoundTemplates=true`,
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
  volumeInGb?: number;
  volumeMountPath?: string;
  dockerEntrypoint?: string[];
  dockerStartCmd?: string[];
  isPublic?: boolean;
  ports?: string[];
  readme?: string;
}) {
  const payload = await runpodJsonRequest<unknown>(`${runpodServiceConfig.restApiBaseUrl}/templates`, {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      imageName: params.imageName,
      env: params.env ?? {},
      category: "NVIDIA",
      containerDiskInGb: params.containerDiskInGb ?? 50,
      ...(params.volumeInGb != null ? { volumeInGb: params.volumeInGb } : {}),
      ...(params.volumeMountPath ? { volumeMountPath: params.volumeMountPath } : {}),
      ...(params.dockerEntrypoint ? { dockerEntrypoint: params.dockerEntrypoint } : {}),
      ...(params.dockerStartCmd ? { dockerStartCmd: params.dockerStartCmd } : {}),
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
    volumeInGb?: number;
    volumeMountPath?: string;
    dockerEntrypoint?: string[];
    dockerStartCmd?: string[];
    isPublic?: boolean;
    ports?: string[];
    readme?: string;
  },
) {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodServiceConfig.restApiBaseUrl}/templates/${encodeURIComponent(templateId)}/update`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(params.name ? { name: params.name } : {}),
        ...(params.imageName ? { imageName: params.imageName } : {}),
        ...(params.env ? { env: params.env } : {}),
        ...(params.containerDiskInGb != null
          ? { containerDiskInGb: params.containerDiskInGb }
          : {}),
        ...(params.volumeInGb != null ? { volumeInGb: params.volumeInGb } : {}),
        ...(params.volumeMountPath ? { volumeMountPath: params.volumeMountPath } : {}),
        ...(params.dockerEntrypoint ? { dockerEntrypoint: params.dockerEntrypoint } : {}),
        ...(params.dockerStartCmd ? { dockerStartCmd: params.dockerStartCmd } : {}),
        ...(params.isPublic != null ? { isPublic: params.isPublic } : {}),
        ...(params.ports ? { ports: params.ports } : {}),
        ...(params.readme != null ? { readme: params.readme } : {}),
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
  const payload = await runpodJsonRequest<unknown>(`${runpodServiceConfig.restApiBaseUrl}/endpoints`, {
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

export async function listRunpodContainerRegistryAuths() {
  const payload = await runpodGraphqlRequest<{
    myself?: {
      containerRegistryCreds?: unknown[] | null;
    } | null;
  }>(
    "ListContainerRegistryAuths",
    `
      query ListContainerRegistryAuths {
        myself {
          id
          containerRegistryCreds {
            id
            name
          }
        }
      }
    `,
  );

  return (payload.myself?.containerRegistryCreds ?? [])
    .map((entry) => normalizeContainerRegistryAuthRecord(entry))
    .filter((entry): entry is RunpodContainerRegistryAuthRecord => Boolean(entry));
}

export async function findRunpodContainerRegistryAuthByName(name: string) {
  const targetName = trimToNull(name);
  const records = await listRunpodContainerRegistryAuths();
  return records.find((entry) => trimToNull(entry.name) === targetName) ?? null;
}

export async function createRunpodContainerRegistryAuth(params: {
  name: string;
  username: string;
  password: string;
}) {
  const payload = await runpodGraphqlRequest<{
    saveRegistryAuth?: unknown;
  }>(
    "SaveRegistryAuth",
    `
      mutation SaveRegistryAuth($input: SaveRegistryAuthInput) {
        saveRegistryAuth(input: $input) {
          id
          name
        }
      }
    `,
    {
      input: {
        name: params.name,
        username: params.username,
        password: params.password,
      },
    },
  );

  const record = normalizeContainerRegistryAuthRecord(payload.saveRegistryAuth);
  if (!record) {
    throw new Error("Runpod registry auth create response missing id.");
  }
  return record;
}

export async function getRunpodEndpoint(endpointId: string) {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodServiceConfig.restApiBaseUrl}/endpoints/${encodeURIComponent(endpointId)}`,
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
  dataCenterIds?: string[];
  networkVolumeId?: string;
  networkVolumeIds?: string[];
  gpuCount?: number;
  workersMin?: number;
  workersMax?: number;
  idleTimeout?: number;
  executionTimeoutMs?: number;
  flashboot?: boolean;
  scalerType?: "QUEUE_DELAY" | "REQUEST_COUNT";
  scalerValue?: number;
}) {
  const payload = await runpodJsonRequest<unknown>(`${runpodServiceConfig.restApiBaseUrl}/endpoints`, {
    method: "POST",
    body: JSON.stringify({
      templateId: params.templateId,
      name: params.name,
      computeType: "GPU",
      gpuTypeIds: params.gpuTypeIds,
      ...(params.dataCenterIds ? { dataCenterIds: params.dataCenterIds } : {}),
      ...(params.networkVolumeId ? { networkVolumeId: params.networkVolumeId } : {}),
      ...(params.networkVolumeIds ? { networkVolumeIds: params.networkVolumeIds } : {}),
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
    dataCenterIds?: string[];
    networkVolumeId?: string;
    networkVolumeIds?: string[];
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
    `${runpodServiceConfig.restApiBaseUrl}/endpoints/${encodeURIComponent(endpointId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...(params.name ? { name: params.name } : {}),
        ...(params.templateId ? { templateId: params.templateId } : {}),
        ...(params.gpuTypeIds ? { gpuTypeIds: params.gpuTypeIds } : {}),
        ...(params.dataCenterIds ? { dataCenterIds: params.dataCenterIds } : {}),
        ...(params.networkVolumeId ? { networkVolumeId: params.networkVolumeId } : {}),
        ...(params.networkVolumeIds ? { networkVolumeIds: params.networkVolumeIds } : {}),
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

export async function createRunpodLoadBalancerEndpoint(params: {
  name: string;
  imageName: string;
  env: Record<string, string>;
  containerDiskInGb: number;
  containerRegistryAuthId?: string | null;
  volumeMountPath: string;
  ports?: string[];
  readme?: string;
  networkVolumeIds?: string[];
  gpuIds: string;
  gpuCount?: number;
  dataCenterIds?: string[];
  workersMin?: number;
  workersMax?: number;
  idleTimeout?: number;
  executionTimeoutMs?: number;
  flashboot?: boolean;
  scalerValue?: number;
}) {
  const portString = (params.ports ?? [])
    .map((entry) => trimToNull(entry))
    .filter((entry): entry is string => Boolean(entry))
    .join(",");
  const env = Object.entries(params.env)
    .filter((entry): entry is [string, string] => Boolean(trimToNull(entry[0])) && entry[1] != null)
    .map(([key, value]) => ({ key, value }));

  const payload = await runpodGraphqlRequest<{
    saveEndpoint?: unknown;
  }>(
    "SaveEndpoint",
    `
      mutation SaveEndpoint($input: EndpointInput!) {
        saveEndpoint(input: $input) {
          id
          name
          type
          gpuIds
          locations
          networkVolumeIds {
            networkVolumeId
            dataCenterId
          }
          scalerType
          scalerValue
          workersMin
          workersMax
          idleTimeout
          executionTimeoutMs
          flashBootType
          templateId
        }
      }
    `,
    {
      input: {
        name: params.name,
        type: "LB",
        idleTimeout: params.idleTimeout ?? 60,
        locations: params.dataCenterIds?.length ? params.dataCenterIds.join(",") : null,
        networkVolumeIds: params.networkVolumeIds?.length
          ? params.networkVolumeIds.map((networkVolumeId) => ({ networkVolumeId }))
          : null,
        scalerType: "REQUEST_COUNT",
        scalerValue: params.scalerValue ?? 1,
        workersMin: params.workersMin ?? 0,
        workersMax: params.workersMax ?? 1,
        executionTimeoutMs: params.executionTimeoutMs ?? 600_000,
        flashBootType: params.flashboot === false ? "OFF" : "FLASHBOOT",
        gpuIds: params.gpuIds,
        gpuCount: params.gpuCount ?? 1,
        template: {
          name: `${params.name}__template__${Math.random().toString(36).substring(7)}`,
          imageName: params.imageName,
          containerDiskInGb: params.containerDiskInGb,
          containerRegistryAuthId: params.containerRegistryAuthId ?? "",
          dockerArgs: "",
          startScript: "",
          readme: params.readme ?? "",
          advancedStart: false,
          env,
          ports: portString,
        },
      },
    },
  );

  const record = normalizeEndpointRecord(payload.saveEndpoint);
  if (!record) {
    throw new Error("Runpod load balancer endpoint create response missing endpoint id.");
  }
  return record;
}

export async function deleteRunpodEndpoint(endpointId: string) {
  return runpodJsonRequest<unknown>(
    `${runpodServiceConfig.restApiBaseUrl}/endpoints/${encodeURIComponent(endpointId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function listRunpodNetworkVolumes() {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodServiceConfig.restApiBaseUrl}/networkvolumes`,
    {
      method: "GET",
    },
  );
  return normalizeListResponse<unknown>(payload)
    .map((entry) => normalizeNetworkVolumeRecord(entry))
    .filter((entry): entry is RunpodNetworkVolumeRecord => Boolean(entry));
}

export async function findRunpodNetworkVolumeByName(name: string) {
  const volumes = await listRunpodNetworkVolumes();
  const targetName = trimToNull(name);
  return volumes.find((entry) => trimToNull(entry.name) === targetName) ?? null;
}

export async function createRunpodNetworkVolume(params: {
  name: string;
  size: number;
  dataCenterId: string;
}) {
  const payload = await runpodJsonRequest<unknown>(
    `${runpodServiceConfig.restApiBaseUrl}/networkvolumes`,
    {
      method: "POST",
      body: JSON.stringify({
        name: params.name,
        size: params.size,
        dataCenterId: params.dataCenterId,
      }),
    },
  );
  const record = normalizeNetworkVolumeRecord(payload);
  if (!record) {
    throw new Error("Runpod network volume create response missing volume id.");
  }
  return record;
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

export async function getRunpodLoadBalancerPing(
  endpointId: string,
  params?: { timeoutMs?: number },
) {
  const apiKey = getRunpodApiKey();
  if (!apiKey) {
    throw new Error("RUNPOD_API_KEY is required.");
  }

  const response = await fetch(`${buildRunpodLoadBalancerBaseUrl(endpointId)}/ping`, {
    method: "GET",
    signal: AbortSignal.timeout(params?.timeoutMs ?? 10_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

export async function listRunpodLoadBalancerModels(endpointId: string) {
  return runpodJsonRequest<{ data?: Array<{ id?: string | null }> }>(
    `${buildRunpodLoadBalancerBaseUrl(endpointId)}/v1/models`,
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
  timeoutMs?: number;
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
      signal: AbortSignal.timeout(params.timeoutMs ?? 180_000),
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

export async function createRunpodLoadBalancerChatCompletion(params: {
  endpointId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) {
  return runpodJsonRequest<OpenAiCompatibleChatResponse>(
    `${buildRunpodLoadBalancerBaseUrl(params.endpointId)}/v1/chat/completions`,
    {
      method: "POST",
      signal: AbortSignal.timeout(params.timeoutMs ?? 180_000),
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
