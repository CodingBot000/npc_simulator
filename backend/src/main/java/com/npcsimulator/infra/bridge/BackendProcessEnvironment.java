package com.npcsimulator.infra.bridge;

import com.npcsimulator.infra.runtime.BackendRuntimeLayout;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class BackendProcessEnvironment {

    private static final Set<String> EXACT_KEYS = Set.of(
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
        "CANONICAL_MODEL_FAMILY",
        "CANONICAL_TRAINING_BASE_MODEL",
        "LOCAL_CANONICAL_TRAINING_BASE_MODEL",
        "REMOTE_TRAINING_BASE_MODEL",
        "TRAINING_EXECUTION_MODE",
        "LOCAL_TRAINING_EXECUTION_MODE",
        "LLM_PROVIDER_MODE",
        "INTERACTION_MODEL",
        "INTERACTION_FALLBACK_MODEL",
        "INTERACTION_JUDGE_MODE",
        "INTERACTION_JUDGE_MODEL",
        "INTERACTION_JUDGE_TIMEOUT_MS",
        "INTERACTION_JUDGE_MAX_OUTPUT_TOKENS",
        "INTERACTION_JUDGE_ENFORCEMENT",
        "INTERACTION_JUDGE_CONFIDENCE_THRESHOLD",
        "EVAL_MODEL",
        "EVAL_FALLBACK_MODEL",
        "OPENAI_MODEL",
        "LOW_COST_MODEL",
        "PREMIUM_MODEL",
        "LOW_COST_FALLBACK_MODEL",
        "PREMIUM_FALLBACK_MODEL"
    );

    private static final List<String> PREFIXES = List.of(
        "NPC_SIMULATOR_",
        "SPRING_",
        "BACKEND_",
        "FINAL_REPLY_",
        "LOCAL_REPLY_",
        "LOCAL_TRAINING_",
        "SHADOW_COMPARE_",
        "TOGETHER_",
        "BASETEN_",
        "RUNPOD_",
        "TOKENIZERS_",
        "MLX_",
        "PYTORCH_",
        "OMP_",
        "MKL_",
        "ACCELERATE_",
        "HF_",
        "HUGGINGFACE_",
        "TRANSFORMERS_"
    );

    private BackendProcessEnvironment() {}

    public static void apply(
        Map<String, String> environment,
        BackendRuntimeLayout runtimeLayout,
        String datasourceUrl,
        String datasourceUsername,
        String datasourcePassword
    ) {
        Map<String, String> source = new LinkedHashMap<>(environment);
        environment.clear();

        for (Map.Entry<String, String> entry : source.entrySet()) {
            String key = entry.getKey();
            String value = entry.getValue();
            if (value == null) {
                continue;
            }
            if (EXACT_KEYS.contains(key) || PREFIXES.stream().anyMatch(key::startsWith)) {
                environment.put(key, value);
            }
        }

        environment.put("NPC_SIMULATOR_ROOT", runtimeLayout.projectRoot().toString());
        environment.put("NPC_SIMULATOR_WORKDIR", runtimeLayout.workingDirectory().toString());
        environment.put("NPC_SIMULATOR_SCRIPTS_ROOT", runtimeLayout.scriptsRoot().toString());
        environment.put("NPC_SIMULATOR_NODE_BIN_DIR", runtimeLayout.nodeBinDirectory().toString());
        environment.put("NPC_SIMULATOR_DATA_ROOT", runtimeLayout.dataRoot().toString());
        environment.put("NPC_SIMULATOR_OUTPUTS_ROOT", runtimeLayout.outputsRoot().toString());
        environment.put("NPC_SIMULATOR_VENV_ROOT", runtimeLayout.venvRoot().toString());

        putIfPresent(environment, "SPRING_DATASOURCE_URL", datasourceUrl);
        putIfPresent(environment, "SPRING_DATASOURCE_USERNAME", datasourceUsername);
        putIfPresent(environment, "SPRING_DATASOURCE_PASSWORD", datasourcePassword);
    }

    private static void putIfPresent(Map<String, String> environment, String key, String value) {
        if (value != null && !value.isBlank()) {
            environment.put(key, value);
        }
    }
}
