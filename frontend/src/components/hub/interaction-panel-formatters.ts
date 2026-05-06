import type { InteractionTraceEntry, RoundState } from "@/lib/types";
import type {
  ConversationMessage,
  FailureDebugEntry,
  InteractionTraceTurn,
} from "@/components/hub/interaction-panel-types";

type DiagnosticsRecord = Record<string, unknown>;

export type VllmRewriteAttemptViewModel = {
  attempt: number;
  status: string;
  durationMs: number | null;
  timeoutMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
};

export type VllmRewriteReadinessViewModel = {
  status: string;
  durationMs: number | null;
  timeoutMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
};

export type VllmRewriteStatusCheckStepViewModel = {
  status: string;
  durationMs: number | null;
  timeoutMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
  responseTextPreview: string | null;
  modelCount: number | null;
  requestedModelFound: boolean | null;
  modelIds: string[];
};

export type VllmRewritePostFailureStatusCheckViewModel = {
  trigger: string | null;
  durationMs: number | null;
  timeoutMs: number | null;
  verdict: string | null;
  ping: VllmRewriteStatusCheckStepViewModel | null;
  models: VllmRewriteStatusCheckStepViewModel | null;
};

export type VllmRewriteDiagnosticsViewModel = {
  badge: string;
  tone: "ok" | "failed" | "timeout" | "fallback" | "neutral";
  summary: string;
  sourceRef: string | null;
  provider: string | null;
  endpointMode: string | null;
  endpointId: string | null;
  model: string | null;
  maxTokens: number | null;
  promptChars: number | null;
  systemMessageChars: number | null;
  userMessageChars: number | null;
  attemptCount: number | null;
  attempts: VllmRewriteAttemptViewModel[];
  readinessCheck: VllmRewriteReadinessViewModel | null;
  postFailureStatusCheck: VllmRewritePostFailureStatusCheckViewModel | null;
  decision: string | null;
  requestDurationMs: number | null;
};

export const SHOW_INTERACTION_FAILURE_DEBUG =
  (import.meta.env.VITE_SHOW_INTERACTION_FAILURE_DEBUG ?? "true").toLowerCase() !==
  "false";

export function roundStatus(round: RoundState) {
  if (round.currentRound === 0) {
    return "아직 첫 턴 전이다. 지금 시작하는 한 마디가 첫 압력 이동이 된다.";
  }

  if (round.currentRound < round.minRoundsBeforeResolution) {
    return `지금은 ${round.currentRound}라운드다. 결말 전까지 아직 흔들 여지가 남아 있다.`;
  }

  return `지금은 ${round.currentRound}라운드다. 이제 판세가 굳으면 바로 결말이 날 수 있다.`;
}

export function formatConversationTimestamp(timestamp: string) {
  const source = new Date(timestamp);

  if (Number.isNaN(source.getTime())) {
    return "--.-- --:--:--";
  }

  const kst = new Date(source.getTime() + 9 * 60 * 60 * 1000);
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  const hour = String(kst.getUTCHours()).padStart(2, "0");
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  const second = String(kst.getUTCSeconds()).padStart(2, "0");

  return `${month}.${day} ${hour}:${minute}:${second}`;
}

export function formatElapsedDuration(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}분 ${String(seconds).padStart(2, "0")}초`;
  }

  return `${totalSeconds}초`;
}

export function formatReplyRewriteSource(source: string | null | undefined) {
  const normalized = source?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const [provider] = normalized.split(":");
  const locality = provider === "local" ? "local" : "remote";
  const providerLabel =
    provider && provider !== "local" ? provider.replace(/_/gu, "-") : null;
  const baseten400ToOpenAiFallback = normalized.includes("fallback_from_baseten_400");
  const runpodToOpenAiFallback = normalized.includes("fallback_from_runpod_error");

  const formatLabel = (modelLabel: string) =>
    [
      locality,
      providerLabel,
      modelLabel,
      baseten400ToOpenAiFallback ? "baseten400→openai" : null,
      runpodToOpenAiFallback ? "runpod→openai" : null,
    ]
      .filter(Boolean)
      .join(" · ");

  if (normalized.includes("llama")) {
    return formatLabel("llama");
  }

  if (normalized.includes("qwen")) {
    return formatLabel("qwen");
  }

  if (/gpt[-_]?5\.4/u.test(normalized)) {
    return formatLabel("gpt5.4");
  }

  if (/gpt[-_\w.]*nano/u.test(normalized)) {
    return formatLabel("gpt-nano");
  }

  if (/gpt[-_\w.]*mini/u.test(normalized)) {
    return formatLabel("gpt-mini");
  }

  const gptVersion = normalized.match(/gpt[-_]?(\d+(?:\.\d+)?)/u);
  if (gptVersion) {
    return formatLabel(`gpt${gptVersion[1]}`);
  }

  return [
    locality,
    providerLabel,
    baseten400ToOpenAiFallback ? "baseten400→openai" : null,
    runpodToOpenAiFallback ? "runpod→openai" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatReplyRewriteReason(reason: string | null | undefined) {
  const normalized = reason?.trim();
  return normalized ? normalized : null;
}

export function formatTraceDuration(durationMs: number) {
  if (durationMs >= 60_000) {
    return `${(durationMs / 60_000).toFixed(2)}m`;
  }
  if (durationMs >= 1_000) {
    return `${(durationMs / 1_000).toFixed(2)}s`;
  }
  return `${durationMs}ms`;
}

export function formatTraceStatus(status: InteractionTraceEntry["status"]) {
  switch (status) {
    case "ok":
      return "정상";
    case "failed":
      return "실패";
    case "fallback":
      return "fallback";
    case "skipped":
      return "건너뜀";
    default:
      return status;
  }
}

export function formatJudgeBoolean(value: boolean | null | undefined) {
  if (value === true) {
    return "yes";
  }
  if (value === false) {
    return "no";
  }
  return "n/a";
}

export function buildInteractionTraceTurns(
  conversation: ConversationMessage[],
  replyElapsedByMessageId: Record<string, number>,
) {
  const turns: InteractionTraceTurn[] = [];

  for (let index = 0; index < conversation.length; index += 1) {
    const message = conversation[index];
    if (message.speaker !== "npc") {
      continue;
    }

    let playerMessage: ConversationMessage | null = null;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = conversation[cursor];
      if (candidate.speaker === "player") {
        playerMessage = candidate;
        break;
      }
    }

    turns.push({
      npcMessage: message,
      playerMessage,
      traceEntries: message.interactionTrace ?? [],
      frontendElapsedMs:
        message.speaker === "npc" &&
        replyElapsedByMessageId[message.id] !== undefined
          ? replyElapsedByMessageId[message.id]
          : null,
    });
  }

  return turns.reverse();
}

export function buildVllmRewriteDiagnostics(params: {
  traceEntries: InteractionTraceEntry[];
  failureDebugEntries: FailureDebugEntry[];
  replyRewriteSource: string | null | undefined;
}) {
  const rewriteRequest =
    params.traceEntries.find((entry) => entry.stage === "reply_rewrite_request") ??
    null;
  const traceDiagnostics = asDiagnosticsRecord(rewriteRequest?.diagnostics);
  const failureDiagnostics =
    params.failureDebugEntries
      .map((entry) => asDiagnosticsRecord(entry.diagnostics))
      .find((diagnostics) => diagnostics?.provider === "runpod") ?? null;
  const diagnostics = traceDiagnostics ?? failureDiagnostics;
  const sourceRef = rewriteRequest?.sourceRef ?? params.replyRewriteSource ?? null;
  const sourceParts = parseRunpodSourceRef(sourceRef);
  const provider = readString(diagnostics?.provider) ?? sourceParts?.provider ?? null;

  if (provider !== "runpod" && !sourceRef?.toLowerCase().includes("runpod")) {
    return null;
  }

  const attempts = readAttemptDiagnostics(diagnostics?.attempts);
  const readinessCheck = readReadinessDiagnostics(diagnostics?.readinessCheck);
  const postFailureStatusCheck = readPostFailureStatusCheck(
    diagnostics?.postFailureStatusCheck,
  );
  const decision = readString(diagnostics?.decision);
  const openAiFallbackTrace =
    params.traceEntries.find(
      (entry) =>
        entry.stage === "reply_rewrite_retry_request" &&
        entry.sourceRef?.toLowerCase().includes("openai"),
    ) ?? null;
  const openAiFallbackApplied =
    openAiFallbackTrace?.status === "ok" ||
    params.replyRewriteSource?.toLowerCase().includes("fallback_from_runpod_error") ||
    false;
  const requestStatus = rewriteRequest?.status ?? null;
  const hasTimeout =
    attempts.some((attempt) => attempt.status === "timeout") ||
    readinessCheck?.status === "timeout";
  const failed =
    (!openAiFallbackApplied && requestStatus === "failed") ||
    decision === "failed_no_retry" ||
    decision === "fallback_to_base_reply";
  const badge = openAiFallbackApplied
    ? hasTimeout
      ? "vLLM timeout · OpenAI fallback"
      : "vLLM 실패 · OpenAI fallback"
    : hasTimeout
    ? "vLLM timeout"
    : failed
      ? decision === "fallback_to_base_reply"
        ? "기본 대사 유지"
        : "vLLM rewrite 실패"
      : requestStatus === "ok" || decision === "accepted"
        ? "vLLM rewrite 성공"
        : "vLLM 진단";
  const tone = openAiFallbackApplied
    ? "fallback"
    : hasTimeout
    ? "timeout"
    : failed
      ? decision === "fallback_to_base_reply"
        ? "fallback"
        : "failed"
      : requestStatus === "ok" || decision === "accepted"
        ? "ok"
        : "neutral";

  return {
    badge,
    tone,
    summary:
      openAiFallbackApplied
        ? "RunPod rewrite failed; OpenAI fallback rewrite applied"
        : tone === "ok"
        ? "RunPod LoRA rewrite applied"
        : "RunPod rewrite failed, base interaction reply kept",
    sourceRef,
    provider,
    endpointMode: readString(diagnostics?.endpointMode),
    endpointId:
      normalizeDiagnosticEndpointId(readString(diagnostics?.endpointId)) ??
      sourceParts?.endpointId ??
      null,
    model: readString(diagnostics?.model) ?? sourceParts?.model ?? null,
    maxTokens: readNumber(diagnostics?.maxTokens),
    promptChars: readNumber(diagnostics?.promptChars),
    systemMessageChars: readNumber(diagnostics?.systemMessageChars),
    userMessageChars: readNumber(diagnostics?.userMessageChars),
    attemptCount:
      readNumber(diagnostics?.attemptCount) ?? (attempts.length > 0 ? attempts.length : null),
    attempts,
    readinessCheck,
    postFailureStatusCheck,
    decision,
    requestDurationMs: rewriteRequest?.durationMs ?? null,
  } satisfies VllmRewriteDiagnosticsViewModel;
}

export function formatFailureDebugStage(params: {
  entry: FailureDebugEntry;
  replyRewriteReason: string | null;
}) {
  switch (params.entry.stage) {
    case "interaction_provider":
      return "기본 생성 실패";
    case "interaction_validation":
      return "기본 생성 검증 실패";
    case "reply_rewrite":
      return params.replyRewriteReason ? "최종 rewrite 실패" : "rewrite 중간 실패";
    default:
      return "실패";
  }
}

function asDiagnosticsRecord(value: unknown): DiagnosticsRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DiagnosticsRecord)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readAttemptDiagnostics(value: unknown): VllmRewriteAttemptViewModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = asDiagnosticsRecord(entry);
      if (!record) {
        return null;
      }
      const attempt = readNumber(record.attempt);
      const status = readString(record.status);
      if (attempt === null || !status) {
        return null;
      }
      return {
        attempt,
        status,
        durationMs: readNumber(record.durationMs),
        timeoutMs: readNumber(record.timeoutMs),
        httpStatus: readNumber(record.httpStatus),
        errorMessage: readString(record.errorMessage),
      } satisfies VllmRewriteAttemptViewModel;
    })
    .filter((entry): entry is VllmRewriteAttemptViewModel => Boolean(entry));
}

function readReadinessDiagnostics(value: unknown): VllmRewriteReadinessViewModel | null {
  const record = asDiagnosticsRecord(value);
  if (!record) {
    return null;
  }
  const status = readString(record.status);
  if (!status) {
    return null;
  }
  return {
    status,
    durationMs: readNumber(record.durationMs),
    timeoutMs: readNumber(record.timeoutMs),
    httpStatus: readNumber(record.httpStatus),
    errorMessage: readString(record.errorMessage),
  };
}

function readPostFailureStatusCheck(
  value: unknown,
): VllmRewritePostFailureStatusCheckViewModel | null {
  const record = asDiagnosticsRecord(value);
  if (!record) {
    return null;
  }

  return {
    trigger: readString(record.trigger),
    durationMs: readNumber(record.durationMs),
    timeoutMs: readNumber(record.timeoutMs),
    verdict: readString(record.verdict),
    ping: readStatusCheckStep(record.ping),
    models: readStatusCheckStep(record.models),
  };
}

function readStatusCheckStep(value: unknown): VllmRewriteStatusCheckStepViewModel | null {
  const record = asDiagnosticsRecord(value);
  if (!record) {
    return null;
  }
  const status = readString(record.status);
  if (!status) {
    return null;
  }
  return {
    status,
    durationMs: readNumber(record.durationMs),
    timeoutMs: readNumber(record.timeoutMs),
    httpStatus: readNumber(record.httpStatus),
    errorMessage: readString(record.errorMessage),
    responseTextPreview: readString(record.responseTextPreview),
    modelCount: readNumber(record.modelCount),
    requestedModelFound:
      typeof record.requestedModelFound === "boolean"
        ? record.requestedModelFound
        : null,
    modelIds: Array.isArray(record.modelIds)
      ? record.modelIds.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function parseRunpodSourceRef(sourceRef: string | null) {
  const normalized = sourceRef?.trim();
  if (!normalized?.toLowerCase().startsWith("runpod:")) {
    return null;
  }
  const [, endpointId, ...modelParts] = normalized.split(":");
  return {
    provider: "runpod",
    endpointId: endpointId ? maskDiagnosticEndpointId(endpointId) : null,
    model: modelParts.join(":") || null,
  };
}

function normalizeDiagnosticEndpointId(endpointId: string | null) {
  if (!endpointId) {
    return null;
  }
  return endpointId.includes("...") ? endpointId : maskDiagnosticEndpointId(endpointId);
}

function maskDiagnosticEndpointId(endpointId: string) {
  const trimmed = endpointId.trim();
  if (trimmed.length <= 10) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-6)}`;
}
