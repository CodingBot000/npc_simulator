import type { SystemInfo } from "@/lib/api-contract";
import {
  buildClientApiUrl,
} from "@/lib/api-client";
import { resolveClientApiBaseUrlConfig } from "@/lib/runtime-config";

export type ApiDiagnosticStatus =
  | "checking"
  | "reachable"
  | "http_error"
  | "network_error"
  | "cors_suspected";

export interface ApiDiagnosticsSnapshot {
  apiBaseUrl: string;
  apiBaseUrlSource: "runtime_config" | "vite_env" | "default_localhost";
  browserOrigin: string;
  apiOrigin: string;
  crossOrigin: boolean;
  status: ApiDiagnosticStatus;
  summary: string;
  detail: string;
  checkedAt: string | null;
  httpStatus: number | null;
  systemInfo: SystemInfo | null;
}

function createBaseSnapshot(): ApiDiagnosticsSnapshot {
  const apiConfig = resolveClientApiBaseUrlConfig();
  const apiBaseUrl = apiConfig.apiBaseUrl;
  const browserOrigin = window.location.origin;
  const apiOrigin = new URL(apiBaseUrl, window.location.href).origin;

  return {
    apiBaseUrl,
    apiBaseUrlSource: apiConfig.source,
    browserOrigin,
    apiOrigin,
    crossOrigin: apiOrigin !== browserOrigin,
    status: "checking",
    summary: "백엔드 연결 상태를 확인하는 중",
    detail: "초기 API 진단을 실행하고 있습니다.",
    checkedAt: null,
    httpStatus: null,
    systemInfo: null,
  };
}

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function readResponseMessage(response: Response) {
  const payload = (await response.clone().json().catch(() => null)) as
    | { message?: string }
    | null;
  return trimToNull(payload?.message) ?? null;
}

export function createInitialApiDiagnostics() {
  return createBaseSnapshot();
}

export async function probeApiDiagnostics(
  signal?: AbortSignal,
): Promise<ApiDiagnosticsSnapshot> {
  const base = createBaseSnapshot();
  const diagnosticUrl = buildClientApiUrl("/api/system/info");
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(diagnosticUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal,
    });

    if (!response.ok) {
      const message = await readResponseMessage(response);

      return {
        ...base,
        status: "http_error",
        summary: `백엔드가 HTTP ${response.status} 응답을 반환했습니다.`,
        detail:
          message ??
          "브라우저는 백엔드에 도달했지만 정상 응답을 받지 못했습니다. 서버 로그와 API 라우트를 확인하세요.",
        checkedAt,
        httpStatus: response.status,
      };
    }

    const systemInfo = (await response.json()) as SystemInfo;

    return {
      ...base,
      status: "reachable",
      summary: `${systemInfo.service} 응답 확인`,
      detail: `백엔드 상태=${systemInfo.status}, phase=${systemInfo.phase}`,
      checkedAt,
      systemInfo,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    const message =
      error instanceof Error ? trimToNull(error.message) : null;

    if (base.crossOrigin) {
      return {
        ...base,
        status: "cors_suspected",
        summary: "브라우저가 교차 출처 API 응답을 읽지 못했습니다.",
        detail:
          message ??
          `현재 origin ${base.browserOrigin} 에서 ${base.apiOrigin} 로 요청 중입니다. CORS allowed origins 또는 API base URL을 확인하세요.`,
        checkedAt,
      };
    }

    return {
      ...base,
      status: "network_error",
      summary: "백엔드에 연결하지 못했습니다.",
      detail:
        message ??
        "네트워크 오류 또는 백엔드 미기동 상태일 수 있습니다. 포트와 컨테이너 상태를 확인하세요.",
      checkedAt,
    };
  }
}
