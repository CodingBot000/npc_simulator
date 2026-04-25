import path from "node:path";
import { fileURLToPath } from "node:url";

function filterDefinedEnv(overrides: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(overrides).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function resolveScriptProjectRoot(
  scriptUrl: string,
  ...relativeSegments: string[]
) {
  const segments = relativeSegments.length > 0 ? relativeSegments : ["..", ".."];
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), ...segments);
}

export function ensureNpcSimulatorRoot(
  scriptUrl: string,
  ...relativeSegments: string[]
) {
  const projectRoot = resolveScriptProjectRoot(scriptUrl, ...relativeSegments);
  process.env.NPC_SIMULATOR_ROOT ??= projectRoot;
  return projectRoot;
}

export function buildChildProcessEnv(
  projectRoot: string,
  overrides: Record<string, string | undefined> = {},
) {
  return {
    ...process.env,
    NPC_SIMULATOR_ROOT: projectRoot,
    ...filterDefinedEnv(overrides),
  };
}
