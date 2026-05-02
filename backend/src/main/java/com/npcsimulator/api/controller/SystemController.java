package com.npcsimulator.api.controller;

import com.npcsimulator.api.dto.SystemInfoResponse;
import com.npcsimulator.support.DeploymentModeProperties;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/system")
public class SystemController {

    private final String deploymentMode;
    private final DeploymentModeProperties deploymentModeProperties;
    private final String datasourceUrl;
    private final String providerMode;
    private final String openAiApiKey;
    private final String finalReplyMode;
    private final String finalReplyBackend;
    private final String finalReplyRemoteModelName;
    private final String finalReplyBasetenModelId;
    private final String finalReplyBasetenModelUrl;
    private final String finalReplyRunpodEndpointId;
    private final String togetherApiKey;
    private final String runpodApiKey;
    private final String basetenApiKey;

    public SystemController(
        DeploymentModeProperties deploymentModeProperties,
        @Value("${spring.datasource.url:}") String datasourceUrl,
        @Value("${LLM_PROVIDER_MODE:codex}") String providerMode,
        @Value("${OPENAI_API_KEY:}") String openAiApiKey,
        @Value("${FINAL_REPLY_MODE:off}") String finalReplyMode,
        @Value("${FINAL_REPLY_BACKEND:off}") String finalReplyBackend,
        @Value("${FINAL_REPLY_REMOTE_MODEL_NAME:}") String finalReplyRemoteModelName,
        @Value("${FINAL_REPLY_BASETEN_MODEL_ID:${BASETEN_MODEL_ID:}}") String finalReplyBasetenModelId,
        @Value("${FINAL_REPLY_BASETEN_MODEL_URL:${BASETEN_MODEL_URL:}}") String finalReplyBasetenModelUrl,
        @Value("${FINAL_REPLY_RUNPOD_ENDPOINT_ID:${RUNPOD_ENDPOINT_ID:}}") String finalReplyRunpodEndpointId,
        @Value("${TOGETHER_API_KEY:}") String togetherApiKey,
        @Value("${RUNPOD_API_KEY:}") String runpodApiKey,
        @Value("${BASETEN_API_KEY:}") String basetenApiKey
    ) {
        this.deploymentModeProperties = deploymentModeProperties;
        this.deploymentMode = deploymentModeProperties.mode();
        this.datasourceUrl = datasourceUrl;
        this.providerMode = normalizeMode(providerMode, "codex");
        this.openAiApiKey = openAiApiKey;
        this.finalReplyMode = normalizeMode(finalReplyMode, "off");
        this.finalReplyBackend = normalizeMode(finalReplyBackend, "off");
        this.finalReplyRemoteModelName = finalReplyRemoteModelName;
        this.finalReplyBasetenModelId = finalReplyBasetenModelId;
        this.finalReplyBasetenModelUrl = finalReplyBasetenModelUrl;
        this.finalReplyRunpodEndpointId = finalReplyRunpodEndpointId;
        this.togetherApiKey = togetherApiKey;
        this.runpodApiKey = runpodApiKey;
        this.basetenApiKey = basetenApiKey;
    }

    @GetMapping("/info")
    public SystemInfoResponse info() {
        return new SystemInfoResponse(
            "npc-simulator-backend",
            "ready",
            "runtime-separated",
            List.of(),
            deploymentMode,
            databaseInfo(),
            providerReadiness(),
            finalReplyReadiness(),
            reviewAccess()
        );
    }

    private SystemInfoResponse.ReviewAccess reviewAccess() {
        boolean publicWriteEnabled = deploymentModeProperties.isLocal();
        return new SystemInfoResponse.ReviewAccess(
            true,
            publicWriteEnabled ? "local_unrestricted" : "admin_token_required",
            publicWriteEnabled
        );
    }

    private SystemInfoResponse.DatabaseInfo databaseInfo() {
        if (blank(datasourceUrl)) {
            return new SystemInfoResponse.DatabaseInfo(
                "unconfigured",
                false,
                "SPRING_DATASOURCE_URL이 비어 있습니다. AWS 배포 시 Lightsail managed PostgreSQL JDBC URL을 설정해야 합니다."
            );
        }

        if (datasourceUrl.matches("^(?:jdbc:)?postgres(?:ql)?:.*")) {
            return new SystemInfoResponse.DatabaseInfo(
                "postgres",
                true,
                datasourceUrl.contains("localhost")
                    ? "로컬 PostgreSQL 연결 설정입니다."
                    : "원격 PostgreSQL 연결 설정입니다. Lightsail managed database URL은 서버 환경변수로만 관리하세요."
            );
        }

        if (datasourceUrl.contains("h2:")) {
            return new SystemInfoResponse.DatabaseInfo(
                "h2",
                true,
                "테스트/로컬 fallback용 H2 연결입니다."
            );
        }

        return new SystemInfoResponse.DatabaseInfo(
            "other",
            true,
            "알 수 없는 datasource 유형입니다."
        );
    }

    private SystemInfoResponse.ProviderReadiness providerReadiness() {
        if ("openai".equals(providerMode)) {
            boolean configured = !blank(openAiApiKey);
            return new SystemInfoResponse.ProviderReadiness(
                "openai",
                configured,
                configured ? "configured" : "missing_openai_api_key",
                configured ? "OpenAI API 사용 가능" : "OPENAI_API_KEY 필요",
                configured
                    ? "OPENAI_API_KEY가 backend 환경에서 감지되었습니다. 값은 응답에 포함하지 않습니다."
                    : "현재 provider mode는 openai이지만 backend 환경에 OPENAI_API_KEY가 없습니다.",
                configured
                    ? "추가 조치가 필요 없습니다."
                    : "AWS/Lightsail 배포 또는 로컬 실행 환경에 OPENAI_API_KEY를 설정하세요. 키는 frontend나 repository에 넣지 마세요."
            );
        }

        if ("deterministic".equals(providerMode)) {
            return new SystemInfoResponse.ProviderReadiness(
                "deterministic",
                true,
                "not_required",
                "Deterministic provider",
                "외부 모델 인증 없이 규칙 기반 응답을 사용합니다.",
                "스모크 테스트나 제한된 로컬 실행에 적합합니다."
            );
        }

        if ("codex".equals(providerMode)) {
            boolean cloudMode = "cloud".equals(deploymentMode);
            return new SystemInfoResponse.ProviderReadiness(
                "codex",
                false,
                cloudMode ? "cloud_codex_not_allowed" : "codex_cli_required",
                cloudMode ? "Cloud에서 Codex CLI 모드 금지" : "Codex CLI 인증 필요",
                cloudMode
                    ? "cloud runtime에서는 Codex CLI 인증 모드를 사용하지 않습니다."
                    : "현재 provider mode는 codex입니다. backend 실행 환경에서 Codex CLI 인증이 필요합니다.",
                cloudMode
                    ? "LLM_PROVIDER_MODE=openai 또는 deterministic으로 변경하세요."
                    : "로컬 또는 허용된 backend 환경에서 codex login을 수행하고 CODEX_HOME 설정을 확인하세요."
            );
        }

        return new SystemInfoResponse.ProviderReadiness(
            providerMode,
            false,
            "unsupported_provider_mode",
            "지원하지 않는 provider mode",
            "LLM_PROVIDER_MODE 값이 현재 runtime에서 지원되지 않습니다.",
            "LLM_PROVIDER_MODE를 openai, codex, deterministic 중 하나로 설정하세요."
        );
    }

    private SystemInfoResponse.FinalReplyReadiness finalReplyReadiness() {
        if ("off".equals(finalReplyMode) || "off".equals(finalReplyBackend)) {
            return new SystemInfoResponse.FinalReplyReadiness(
                finalReplyMode,
                finalReplyBackend,
                true,
                "not_required",
                "Final reply 비활성화",
                "최종 대사 rewrite backend를 사용하지 않습니다.",
                "추가 조치가 필요 없습니다."
            );
        }

        return switch (finalReplyBackend) {
            case "openai_api" -> keyBackedFinalReply(
                "openai_api",
                !blank(openAiApiKey),
                "missing_openai_api_key",
                "OPENAI_API_KEY를 backend 환경변수로 설정하세요."
            );
            case "together" -> keyBackedFinalReply(
                "together",
                !blank(togetherApiKey) && !blank(finalReplyRemoteModelName),
                blank(togetherApiKey) ? "missing_together_api_key" : "missing_final_reply_model",
                "TOGETHER_API_KEY와 FINAL_REPLY_REMOTE_MODEL_NAME을 backend 환경변수로 설정하세요."
            );
            case "runpod" -> keyBackedFinalReply(
                "runpod",
                !blank(runpodApiKey) && !blank(finalReplyRunpodEndpointId) && !blank(finalReplyRemoteModelName),
                runpodMissingStatus(),
                "RUNPOD_API_KEY, FINAL_REPLY_RUNPOD_ENDPOINT_ID, FINAL_REPLY_REMOTE_MODEL_NAME을 backend 환경변수로 설정하세요."
            );
            case "baseten" -> keyBackedFinalReply(
                "baseten",
                !blank(basetenApiKey)
                    && (!blank(finalReplyBasetenModelId) || !blank(finalReplyBasetenModelUrl))
                    && !blank(finalReplyRemoteModelName),
                basetenMissingStatus(),
                "BASETEN_API_KEY, FINAL_REPLY_BASETEN_MODEL_ID 또는 FINAL_REPLY_BASETEN_MODEL_URL, FINAL_REPLY_REMOTE_MODEL_NAME을 backend 환경변수로 설정하세요."
            );
            case "codex" -> new SystemInfoResponse.FinalReplyReadiness(
                finalReplyMode,
                "codex",
                false,
                "cloud".equals(deploymentMode) ? "cloud_codex_not_allowed" : "codex_cli_required",
                "cloud".equals(deploymentMode) ? "Cloud에서 Codex final reply 금지" : "Codex CLI 인증 필요",
                "FINAL_REPLY_BACKEND=codex는 backend 실행 환경의 Codex CLI 인증을 사용합니다.",
                "cloud에서는 openai_api, together, runpod, baseten 중 하나를 사용하세요."
            );
            default -> new SystemInfoResponse.FinalReplyReadiness(
                finalReplyMode,
                finalReplyBackend,
                true,
                "not_required",
                "Local/promoted final reply",
                "선택한 final reply backend는 별도 API key readiness를 SystemInfo에서 검사하지 않습니다.",
                "로컬 MLX runtime path나 promoted artifact 설정은 실행 전 preflight에서 확인하세요."
            );
        };
    }

    private SystemInfoResponse.FinalReplyReadiness keyBackedFinalReply(
        String backend,
        boolean configured,
        String missingStatus,
        String actionGuide
    ) {
        return new SystemInfoResponse.FinalReplyReadiness(
            finalReplyMode,
            backend,
            configured,
            configured ? "configured" : missingStatus,
            configured ? backend + " final reply 사용 가능" : backend + " final reply 자격 증명 필요",
            configured
                ? "필요한 backend API key가 감지되었습니다. 값은 응답에 포함하지 않습니다."
                : "선택한 final reply backend에 필요한 API key가 backend 환경에 없습니다.",
            configured ? "추가 조치가 필요 없습니다." : actionGuide
        );
    }

    private String runpodMissingStatus() {
        if (blank(runpodApiKey)) {
            return "missing_runpod_api_key";
        }
        if (blank(finalReplyRunpodEndpointId)) {
            return "missing_runpod_endpoint";
        }
        return "missing_final_reply_model";
    }

    private String basetenMissingStatus() {
        if (blank(basetenApiKey)) {
            return "missing_baseten_api_key";
        }
        if (blank(finalReplyBasetenModelId) && blank(finalReplyBasetenModelUrl)) {
            return "missing_baseten_model_target";
        }
        return "missing_final_reply_model";
    }

    private String normalizeMode(String value, String fallback) {
        if (blank(value)) {
            return fallback;
        }
        return value.trim().toLowerCase();
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
