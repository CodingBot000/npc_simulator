import {
  formatTraceDuration,
  type VllmRewriteDiagnosticsViewModel,
} from "@/components/hub/interaction-panel-formatters";

export function VllmRewriteDiagnosticsCard({
  diagnostics,
}: {
  diagnostics: VllmRewriteDiagnosticsViewModel;
}) {
  const toneClass = getToneClass(diagnostics.tone);
  const metricItems = [
    diagnostics.promptChars !== null ? `prompt ${diagnostics.promptChars}자` : null,
    diagnostics.systemMessageChars !== null
      ? `system ${diagnostics.systemMessageChars}자`
      : null,
    diagnostics.userMessageChars !== null ? `user ${diagnostics.userMessageChars}자` : null,
    diagnostics.maxTokens !== null ? `max_tokens ${diagnostics.maxTokens}` : null,
  ].filter(Boolean);
  const sourceItems = [
    diagnostics.provider ? `backend ${diagnostics.provider}` : null,
    diagnostics.endpointMode ? `mode ${diagnostics.endpointMode}` : null,
    diagnostics.endpointId ? `endpoint ${diagnostics.endpointId}` : null,
    diagnostics.model ? `model ${diagnostics.model}` : null,
  ].filter(Boolean);

  return (
    <div
      className={`mt-2 space-y-2 rounded-2xl border px-3 py-3 text-[11px] leading-5 ${toneClass}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{diagnostics.badge}</span>
          {diagnostics.decision ? <span>decision={diagnostics.decision}</span> : null}
        </div>
        {diagnostics.requestDurationMs !== null ? (
          <span className="font-semibold text-foreground">
            {formatTraceDuration(diagnostics.requestDurationMs)}
          </span>
        ) : null}
      </div>

      <p className="break-words">{diagnostics.summary}</p>

      {sourceItems.length > 0 ? (
        <p className="break-words">{sourceItems.join(" · ")}</p>
      ) : null}
      {metricItems.length > 0 ? (
        <p className="break-words">{metricItems.join(" · ")}</p>
      ) : null}

      {diagnostics.attempts.length > 0 ? (
        <div className="space-y-1">
          <p className="font-semibold text-foreground">
            attempts={diagnostics.attemptCount ?? diagnostics.attempts.length}
          </p>
          {diagnostics.attempts.map((attempt) => (
            <p key={`vllm-attempt-${attempt.attempt}`} className="break-words">
              #{attempt.attempt} {formatVllmStatus(attempt.status)}
              {attempt.durationMs !== null
                ? ` · duration ${formatTraceDuration(attempt.durationMs)}`
                : ""}
              {attempt.timeoutMs !== null
                ? ` · timeout ${formatTraceDuration(attempt.timeoutMs)}`
                : ""}
              {attempt.httpStatus !== null ? ` · HTTP ${attempt.httpStatus}` : ""}
              {attempt.errorMessage ? ` · ${attempt.errorMessage}` : ""}
            </p>
          ))}
        </div>
      ) : (
        <p>attempt diagnostics 없음</p>
      )}

      {diagnostics.readinessCheck ? (
        <p className="break-words">
          readiness {formatVllmStatus(diagnostics.readinessCheck.status)}
          {diagnostics.readinessCheck.durationMs !== null
            ? ` · duration ${formatTraceDuration(diagnostics.readinessCheck.durationMs)}`
            : ""}
          {diagnostics.readinessCheck.timeoutMs !== null
            ? ` · timeout ${formatTraceDuration(diagnostics.readinessCheck.timeoutMs)}`
            : ""}
          {diagnostics.readinessCheck.httpStatus !== null
            ? ` · HTTP ${diagnostics.readinessCheck.httpStatus}`
            : ""}
          {diagnostics.readinessCheck.errorMessage
            ? ` · ${diagnostics.readinessCheck.errorMessage}`
            : ""}
        </p>
      ) : null}

      {diagnostics.postFailureStatusCheck ? (
        <div className="space-y-1 rounded-xl border border-[rgba(255,255,255,0.14)] bg-black/10 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-foreground">RunPod 상태 체크</p>
            {diagnostics.postFailureStatusCheck.durationMs !== null ? (
              <p className="font-semibold text-foreground">
                {formatTraceDuration(diagnostics.postFailureStatusCheck.durationMs)}
              </p>
            ) : null}
          </div>
          {diagnostics.postFailureStatusCheck.verdict ? (
            <p className="break-words">{diagnostics.postFailureStatusCheck.verdict}</p>
          ) : null}
          {diagnostics.postFailureStatusCheck.ping ? (
            <p className="break-words">
              /ping {formatVllmStatus(diagnostics.postFailureStatusCheck.ping.status)}
              {formatStatusCheckStepSuffix(diagnostics.postFailureStatusCheck.ping)}
            </p>
          ) : null}
          {diagnostics.postFailureStatusCheck.models ? (
            <p className="break-words">
              /v1/models{" "}
              {formatVllmStatus(diagnostics.postFailureStatusCheck.models.status)}
              {formatStatusCheckStepSuffix(diagnostics.postFailureStatusCheck.models)}
              {diagnostics.postFailureStatusCheck.models.modelCount !== null
                ? ` · models=${diagnostics.postFailureStatusCheck.models.modelCount}`
                : ""}
              {diagnostics.postFailureStatusCheck.models.requestedModelFound !== null
                ? ` · requested=${diagnostics.postFailureStatusCheck.models.requestedModelFound ? "found" : "missing"}`
                : ""}
            </p>
          ) : null}
          {diagnostics.postFailureStatusCheck.models?.modelIds.length ? (
            <p className="break-words">
              served models: {diagnostics.postFailureStatusCheck.models.modelIds.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getToneClass(tone: VllmRewriteDiagnosticsViewModel["tone"]) {
  switch (tone) {
    case "ok":
      return "border-[rgba(76,194,200,0.2)] bg-[rgba(76,194,200,0.07)] text-[var(--ink-muted)]";
    case "timeout":
    case "failed":
    case "fallback":
      return "border-[rgba(181,43,48,0.24)] bg-[rgba(181,43,48,0.08)] text-[var(--danger)]";
    default:
      return "border-[var(--panel-border)] bg-white/10 text-[var(--ink-muted)]";
  }
}

function formatVllmStatus(status: string) {
  switch (status) {
    case "ok":
      return "정상";
    case "failed":
      return "실패";
    case "timeout":
      return "timeout";
    case "not_ready":
      return "not ready";
    default:
      return status;
  }
}

function formatStatusCheckStepSuffix(step: {
  durationMs: number | null;
  timeoutMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
  responseTextPreview: string | null;
}) {
  const items = [
    step.durationMs !== null ? `duration ${formatTraceDuration(step.durationMs)}` : null,
    step.timeoutMs !== null ? `timeout ${formatTraceDuration(step.timeoutMs)}` : null,
    step.httpStatus !== null ? `HTTP ${step.httpStatus}` : null,
    step.responseTextPreview ? `body ${step.responseTextPreview}` : null,
    step.errorMessage,
  ].filter(Boolean);

  return items.length > 0 ? ` · ${items.join(" · ")}` : "";
}
