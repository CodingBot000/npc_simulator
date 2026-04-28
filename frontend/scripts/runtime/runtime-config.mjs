import path from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeBaseUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function resolveFrontendRuntimeConfig(env = process.env) {
  const explicitRuntimeUrl = normalizeBaseUrl(
    env.NPC_SIMULATOR_API_BASE_URL,
  );
  if (explicitRuntimeUrl) {
    return {
      apiBaseUrl: explicitRuntimeUrl,
      source: "NPC_SIMULATOR_API_BASE_URL",
    };
  }

  const compatibilityUrl = normalizeBaseUrl(env.VITE_API_BASE_URL);
  if (compatibilityUrl) {
    return {
      apiBaseUrl: compatibilityUrl,
      source: "VITE_API_BASE_URL",
    };
  }

  return {
    apiBaseUrl: "",
    source: null,
  };
}

export function createRuntimeConfigScript(runtimeConfig) {
  return `window.__NPC_SIMULATOR_CONFIG__ = ${JSON.stringify(runtimeConfig)};\n`;
}

export function resolveStaticServerSettings({
  env = process.env,
  scriptUrl,
}) {
  const scriptDir = path.dirname(fileURLToPath(scriptUrl));
  const frontendDir = path.resolve(scriptDir, "../..");

  return {
    frontendDir,
    distDir: env.FRONTEND_DIST_DIR
      ? path.resolve(env.FRONTEND_DIST_DIR)
      : path.join(frontendDir, "dist"),
    port: Number(env.PORT ?? env.FRONTEND_PORT ?? "3000"),
    host: env.HOST ?? "0.0.0.0",
  };
}
