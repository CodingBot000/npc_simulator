import { useEffect, useMemo, useState } from "react";
import {
  createInitialApiDiagnostics,
  probeApiDiagnostics,
  type ApiDiagnosticsSnapshot,
} from "@/lib/api-diagnostics";

const BASE_URL_SOURCE_LABEL = {
  runtime_config: "runtime config",
  vite_env: "Vite env",
  default_localhost: "default localhost",
} as const;

function statusLabel(status: ApiDiagnosticsSnapshot["status"]) {
  switch (status) {
    case "reachable":
      return "정상";
    case "http_error":
      return "HTTP 오류";
    case "network_error":
      return "네트워크 실패";
    case "cors_suspected":
      return "CORS 의심";
    default:
      return "확인 중";
  }
}

function statusClassName(status: ApiDiagnosticsSnapshot["status"]) {
  switch (status) {
    case "reachable":
      return "bg-emerald-500/18 text-emerald-200 border border-emerald-400/25";
    case "http_error":
      return "bg-amber-500/18 text-amber-100 border border-amber-400/25";
    case "network_error":
    case "cors_suspected":
      return "bg-rose-500/16 text-rose-100 border border-rose-400/25";
    default:
      return "bg-slate-200/10 text-slate-100 border border-white/10";
  }
}

function diagnosticToneClass(status: ApiDiagnosticsSnapshot["status"]) {
  switch (status) {
    case "reachable":
      return "text-emerald-100";
    case "http_error":
      return "text-amber-100";
    case "network_error":
    case "cors_suspected":
      return "text-rose-100";
    default:
      return "text-slate-100";
  }
}

function formatCheckedAt(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

export function ApiDiagnosticsPanel() {
  const [snapshot, setSnapshot] = useState<ApiDiagnosticsSnapshot>(
    () => createInitialApiDiagnostics(),
  );
  const [expanded, setExpanded] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDiagnostics() {
      try {
        const nextSnapshot = await probeApiDiagnostics(controller.signal);
        setSnapshot(nextSnapshot);

        if (nextSnapshot.status !== "reachable") {
          setExpanded(true);
        }
      } catch {
        // Ignore aborts and keep the previous snapshot.
      }
    }

    void loadDiagnostics();

    return () => controller.abort();
  }, [refreshToken]);

  const summaryLine = useMemo(
    () => `${statusLabel(snapshot.status)} · ${snapshot.apiOrigin}`,
    [snapshot.apiOrigin, snapshot.status],
  );

  return (
    <aside className="pointer-events-none fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-24px))]">
      <section className="pointer-events-auto panel-surface rounded-2xl border border-white/8 px-4 py-3 shadow-[0_18px_42px_rgba(2,10,17,0.46)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--teal)]">
              API Diagnostics
            </p>
            <p className={`mt-1 text-sm font-semibold ${diagnosticToneClass(snapshot.status)}`}>
              {snapshot.summary}
            </p>
            <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">
              {summaryLine}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${statusClassName(snapshot.status)}`}
            >
              {statusLabel(snapshot.status)}
            </span>
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-white/90 transition hover:border-white/20 hover:bg-white/6"
            >
              {expanded ? "접기" : "열기"}
            </button>
          </div>
        </div>

        {expanded ? (
          <div className="mt-3 space-y-3 border-t border-white/8 pt-3 text-xs text-[var(--foreground)]">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  API Base URL
                </p>
                <p className="break-all font-mono text-[11px]">{snapshot.apiBaseUrl}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Config Source
                </p>
                <p>{BASE_URL_SOURCE_LABEL[snapshot.apiBaseUrlSource]}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Browser Origin
                </p>
                <p className="break-all font-mono text-[11px]">{snapshot.browserOrigin}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  API Origin
                </p>
                <p className="break-all font-mono text-[11px]">{snapshot.apiOrigin}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Cross Origin
                </p>
                <p>{snapshot.crossOrigin ? "yes" : "no"}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Last Checked
                </p>
                <p>{formatCheckedAt(snapshot.checkedAt)}</p>
              </div>
            </div>

            {snapshot.httpStatus ? (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  HTTP Status
                </p>
                <p>{snapshot.httpStatus}</p>
              </div>
            ) : null}

            {snapshot.systemInfo ? (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Backend
                </p>
                <p>
                  {snapshot.systemInfo.service} / {snapshot.systemInfo.status} /{" "}
                  {snapshot.systemInfo.phase}
                </p>
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Detail
              </p>
              <p className="leading-5 text-white/90">{snapshot.detail}</p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setRefreshToken((current) => current + 1)}
                className="rounded-full bg-[var(--teal)] px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:brightness-105"
              >
                다시 확인
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
