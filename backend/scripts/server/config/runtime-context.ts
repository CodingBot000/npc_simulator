import fs from "node:fs";
import path from "node:path";

export type ServerDeploymentMode = "local" | "cloud";
export type ServerEnvResolutionMode = "process_only" | "process_then_dotenv_local";

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function detectProjectRoot() {
  const explicitRoot = process.env.NPC_SIMULATOR_ROOT;

  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const cwd = process.cwd();
  const candidates = [cwd, path.dirname(cwd)];

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "data")) &&
      fs.existsSync(path.join(candidate, "docs"))
    ) {
      return candidate;
    }
  }

  return cwd;
}

function detectServerDeploymentMode(): ServerDeploymentMode {
  const explicitMode =
    trimToNull(process.env.NPC_SIMULATOR_DEPLOYMENT_MODE) ??
    trimToNull(process.env.NPC_SIMULATOR_SERVER_MODE);

  if (explicitMode === "local" || explicitMode === "cloud") {
    return explicitMode;
  }

  const springProfile = trimToNull(process.env.SPRING_PROFILES_ACTIVE);
  const nodeEnv = trimToNull(process.env.NODE_ENV);
  const explicitRoot = trimToNull(process.env.NPC_SIMULATOR_ROOT);

  if (
    springProfile === "prod" ||
    nodeEnv === "production" ||
    explicitRoot === "/workspace"
  ) {
    return "cloud";
  }

  return "local";
}

export const PROJECT_ROOT = detectProjectRoot();
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const LOCAL_SERVER_ENV_FILE_PATH = path.join(PROJECT_ROOT, ".env.local");

const deploymentMode = detectServerDeploymentMode();

export const serverRuntimeContext = {
  deploymentMode,
  isLocalMode: deploymentMode === "local",
  isCloudMode: deploymentMode === "cloud",
  localEnvFallbackEnabled: deploymentMode === "local",
  envResolutionMode:
    deploymentMode === "local"
      ? "process_then_dotenv_local"
      : "process_only",
  localEnvFilePath: LOCAL_SERVER_ENV_FILE_PATH,
} satisfies {
  deploymentMode: ServerDeploymentMode;
  isLocalMode: boolean;
  isCloudMode: boolean;
  localEnvFallbackEnabled: boolean;
  envResolutionMode: ServerEnvResolutionMode;
  localEnvFilePath: string;
};
