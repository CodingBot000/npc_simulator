import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "@server/config";

const DEFAULT_TOGETHER_API_BASE_URL = "https://api.together.xyz/v1";

type RawRecord = Record<string, unknown>;

export interface TogetherFileRecord {
  id: string;
  filename?: string | null;
  purpose?: string | null;
  Processed?: boolean | null;
  processed?: boolean | null;
  bytes?: number | null;
  FileType?: string | null;
  LineCount?: number | null;
}

export interface TogetherFineTuneJobRecord {
  id: string;
  status: string;
  training_file?: string | null;
  validation_file?: string | null;
  model?: string | null;
  output_name?: string | null;
  model_output_name?: string | null;
  model_output_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  n_epochs?: number | null;
  n_checkpoints?: number | null;
  n_evals?: number | null;
  batch_size?: string | number | null;
  learning_rate?: number | null;
  train_on_inputs?: string | boolean | null;
}

export interface TogetherFineTuneEventRecord {
  created_at?: string | null;
  message?: string | null;
  type?: string | null;
  level?: string | null;
  step?: number | null;
  hash?: string | null;
}

type TogetherChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<RawRecord>;
    };
    text?: string;
  }>;
};

let localEnvPromise: Promise<Map<string, string>> | null = null;

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function togetherApiBaseUrl() {
  return trimToNull(process.env.TOGETHER_API_BASE_URL) ?? DEFAULT_TOGETHER_API_BASE_URL;
}

function parseEnvValue(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function readLocalEnvFile() {
  if (!localEnvPromise) {
    localEnvPromise = (async () => {
      const values = new Map<string, string>();
      const envPath = path.join(PROJECT_ROOT, ".env.local");
      let raw = "";
      try {
        raw = await fs.readFile(envPath, "utf8");
      } catch {
        return values;
      }

      for (const line of raw.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) {
          continue;
        }
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
        if (key) {
          values.set(key, value);
        }
      }
      return values;
    })();
  }

  return localEnvPromise;
}

export async function getEnvValueOrLocalFile(key: string) {
  const directValue = trimToNull(process.env[key]);
  if (directValue) {
    return directValue;
  }

  const values = await readLocalEnvFile();
  const fallback = trimToNull(values.get(key));
  if (fallback) {
    process.env[key] = fallback;
  }
  return fallback;
}

export async function getTogetherApiKey() {
  return getEnvValueOrLocalFile("TOGETHER_API_KEY");
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

async function togetherJsonRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
  const apiKey = await getTogetherApiKey();
  if (!apiKey) {
    throw new Error("TOGETHER_API_KEY is required.");
  }

  const response = await fetch(`${togetherApiBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });

  const rawText = await response.text();
  const payload = rawText ? (JSON.parse(rawText) as unknown) : null;
  if (!response.ok) {
    throw new Error(
      normalizeErrorMessage(payload, `Together API request failed (${response.status}).`),
    );
  }
  return payload as T;
}

export async function uploadTogetherFile(params: {
  filePath: string;
  purpose?: string;
}) {
  const fileBytes = await fs.readFile(params.filePath);
  const filename = path.basename(params.filePath);
  const form = new FormData();
  form.set("purpose", params.purpose ?? "fine-tune");
  form.set("file_name", filename);
  form.set("file_type", "jsonl");
  form.set(
    "file",
    new File([fileBytes], filename, {
      type: "application/jsonl",
    }),
  );

  return togetherJsonRequest<TogetherFileRecord>("/files/upload", {
    method: "POST",
    body: form,
  });
}

export async function retrieveTogetherFile(fileId: string) {
  return togetherJsonRequest<TogetherFileRecord>(`/files/${encodeURIComponent(fileId)}`, {
    method: "GET",
  });
}

export async function createTogetherFineTuneJob(params: {
  model: string;
  trainingFileId: string;
  validationFileId?: string | null;
  suffix: string;
  lora?: boolean;
  trainOnInputs?: string | boolean | null;
  nEpochs?: number | null;
  nCheckpoints?: number | null;
  nEvals?: number | null;
  learningRate?: number | null;
  batchSize?: string | number | null;
  warmupRatio?: number | null;
}) {
  const body = {
    model: params.model,
    training_file: params.trainingFileId,
    validation_file: params.validationFileId ?? undefined,
    suffix: params.suffix,
    lora: params.lora ?? true,
    train_on_inputs: params.trainOnInputs ?? "auto",
    n_epochs: params.nEpochs ?? undefined,
    n_checkpoints: params.nCheckpoints ?? undefined,
    n_evals: params.nEvals ?? undefined,
    learning_rate: params.learningRate ?? undefined,
    batch_size: params.batchSize ?? undefined,
    warmup_ratio: params.warmupRatio ?? undefined,
  };

  return togetherJsonRequest<TogetherFineTuneJobRecord>("/fine-tunes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function retrieveTogetherFineTuneJob(jobId: string) {
  return togetherJsonRequest<TogetherFineTuneJobRecord>(
    `/fine-tunes/${encodeURIComponent(jobId)}`,
    {
      method: "GET",
    },
  );
}

export async function listTogetherFineTuneEvents(jobId: string) {
  const response = await togetherJsonRequest<{ data?: TogetherFineTuneEventRecord[] }>(
    `/fine-tunes/${encodeURIComponent(jobId)}/events`,
    {
      method: "GET",
    },
  );
  return Array.isArray(response.data) ? response.data : [];
}

export async function createTogetherChatCompletion(params: {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
}) {
  return togetherJsonRequest<TogetherChatResponse>("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens ?? 160,
      temperature: params.temperature ?? 0.7,
    }),
  });
}

export function extractTogetherOutputName(job: TogetherFineTuneJobRecord | null | undefined) {
  return trimToNull(job?.output_name) ?? trimToNull(job?.model_output_name);
}

export function isTogetherFileProcessed(file: TogetherFileRecord | null | undefined) {
  return Boolean(file?.Processed ?? file?.processed);
}

export function extractTogetherChatText(response: TogetherChatResponse) {
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
