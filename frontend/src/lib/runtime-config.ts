export type ClientApiBaseUrlSource =
  | "runtime_config"
  | "vite_env"
  | "default_localhost";

export interface FrontendRuntimeConfig {
  apiBaseUrl?: string;
  source?: "NPC_SIMULATOR_API_BASE_URL" | "VITE_API_BASE_URL" | null;
}

function normalizeBaseUrl(value: string | undefined | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function getWindowRuntimeConfig(): FrontendRuntimeConfig {
  return window.__NPC_SIMULATOR_CONFIG__ ?? {};
}

export function resolveClientApiBaseUrlConfig() {
  const runtimeConfigUrl = normalizeBaseUrl(getWindowRuntimeConfig().apiBaseUrl);
  if (runtimeConfigUrl) {
    return {
      apiBaseUrl: runtimeConfigUrl,
      source: "runtime_config" as ClientApiBaseUrlSource,
    };
  }

  const viteEnvUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  if (viteEnvUrl) {
    return {
      apiBaseUrl: viteEnvUrl,
      source: "vite_env" as ClientApiBaseUrlSource,
    };
  }

  return {
    apiBaseUrl: "http://localhost:8080",
    source: "default_localhost" as ClientApiBaseUrlSource,
  };
}

