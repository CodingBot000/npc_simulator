import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_SYSTEM_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "NODE_OPTIONS",
  "VIRTUAL_ENV",
  "PYTHONPATH",
  "PYTHONHOME",
  "PIP_INDEX_URL",
  "PIP_EXTRA_INDEX_URL",
  "CODEX_HOME",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_ORG_ID",
  "HF_TOKEN",
  "HF_HOME",
  "HUGGINGFACE_HUB_CACHE",
  "TRANSFORMERS_CACHE",
];

const BACKEND_RUNTIME_ENV_KEYS = [
  "LLM_PROVIDER_MODE",
  "INTERACTION_MODEL",
  "INTERACTION_FALLBACK_MODEL",
  "EVAL_MODEL",
  "EVAL_FALLBACK_MODEL",
  "OPENAI_MODEL",
  "LOW_COST_MODEL",
  "PREMIUM_MODEL",
  "LOW_COST_FALLBACK_MODEL",
  "PREMIUM_FALLBACK_MODEL",
] as const;

const BACKEND_RUNTIME_ENV_PREFIXES = [
  "NPC_SIMULATOR_",
  "SPRING_",
  "BACKEND_",
  "LOCAL_REPLY_",
  "SHADOW_COMPARE_",
  "TOGETHER_",
  "RUNPOD_",
  "TOKENIZERS_",
  "MLX_",
  "PYTORCH_",
  "OMP_",
  "MKL_",
  "ACCELERATE_",
  "HF_",
  "HUGGINGFACE_",
  "TRANSFORMERS_",
] as const;

function filterDefinedEnv(overrides: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(overrides).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function pickProcessEnv(options: {
  exactKeys?: readonly string[];
  prefixes?: readonly string[];
}) {
  const exactKeys = new Set(options.exactKeys ?? []);
  const prefixes = options.prefixes ?? [];
  const selected: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") {
      continue;
    }

    if (exactKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
      selected[key] = value;
    }
  }

  return selected;
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
  return buildAllowedChildProcessEnv(projectRoot, {
    exactKeys: [...BASE_SYSTEM_ENV_KEYS, ...BACKEND_RUNTIME_ENV_KEYS],
    prefixes: BACKEND_RUNTIME_ENV_PREFIXES,
    overrides,
  });
}

export function buildAllowedChildProcessEnv(
  projectRoot: string,
  options: {
    exactKeys?: readonly string[];
    prefixes?: readonly string[];
    overrides?: Record<string, string | undefined>;
  } = {},
) {
  const selected = pickProcessEnv({
    exactKeys: options.exactKeys,
    prefixes: options.prefixes,
  });

  return {
    ...selected,
    NPC_SIMULATOR_ROOT: projectRoot,
    ...filterDefinedEnv(options.overrides ?? {}),
  };
}

export function buildBackendRuntimeChildEnv(
  projectRoot: string,
  overrides: Record<string, string | undefined> = {},
) {
  return buildAllowedChildProcessEnv(projectRoot, {
    exactKeys: [...BASE_SYSTEM_ENV_KEYS, ...BACKEND_RUNTIME_ENV_KEYS],
    prefixes: BACKEND_RUNTIME_ENV_PREFIXES,
    overrides,
  });
}

export function buildModelExecutionChildEnv(
  projectRoot: string,
  overrides: Record<string, string | undefined> = {},
) {
  return buildAllowedChildProcessEnv(projectRoot, {
    exactKeys: [...BASE_SYSTEM_ENV_KEYS, ...BACKEND_RUNTIME_ENV_KEYS],
    prefixes: [
      ...BACKEND_RUNTIME_ENV_PREFIXES,
      "CUDA_",
      "METAL_",
    ],
    overrides,
  });
}

export function buildCodexCliChildEnv(
  projectRoot: string,
  overrides: Record<string, string | undefined> = {},
) {
  return buildAllowedChildProcessEnv(projectRoot, {
    exactKeys: [
      ...BASE_SYSTEM_ENV_KEYS,
      ...BACKEND_RUNTIME_ENV_KEYS,
    ],
    prefixes: [
      "NPC_SIMULATOR_",
      "SPRING_",
      "BACKEND_",
    ],
    overrides,
  });
}
