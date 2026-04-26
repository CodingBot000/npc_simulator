package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.npcsimulator.infra.bridge.BridgeEnvelope;
import com.npcsimulator.infra.bridge.NodeBridgeService;
import com.npcsimulator.infra.runtime.BackendRuntimeLayout;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class RuntimeWorldService {

    private static final int MAX_EVENT_LOG_ENTRIES = 12;
    private static final int MAX_CONVERSATION_MESSAGES = 10;
    private static final String DEFAULT_PLAYER_ID = "local-player";
    private static final String DEFAULT_PLAYER_LABEL = "당신";
    private static final String DEFAULT_PLAYER_TEXT =
        "짧게 숨을 고르며 방 안의 시선을 읽었다.";
    private static final long READ_WAIT_TIMEOUT_MS = 5_000L;
    private static final long READ_WAIT_INTERVAL_MS = 100L;

    private final RuntimeWorldRepository runtimeWorldRepository;
    private final RuntimeScenarioCatalog runtimeScenarioCatalog;
    private final NodeBridgeService nodeBridgeService;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;
    private final boolean postgresDatasource;
    private final String providerMode;
    private final String openAiApiKey;
    private final BackendRuntimeLayout runtimeLayout;

    public RuntimeWorldService(
        RuntimeWorldRepository runtimeWorldRepository,
        RuntimeScenarioCatalog runtimeScenarioCatalog,
        NodeBridgeService nodeBridgeService,
        BackendRuntimeLayout runtimeLayout,
        ObjectMapper objectMapper,
        PlatformTransactionManager transactionManager,
        @Value("${spring.datasource.url:}") String datasourceUrl,
        @Value("${LLM_PROVIDER_MODE:codex}") String providerMode,
        @Value("${OPENAI_API_KEY:}") String openAiApiKey
    ) {
        this.runtimeWorldRepository = runtimeWorldRepository;
        this.runtimeScenarioCatalog = runtimeScenarioCatalog;
        this.nodeBridgeService = nodeBridgeService;
        this.runtimeLayout = runtimeLayout;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.postgresDatasource = datasourceUrl != null && datasourceUrl.matches("^(?:jdbc:)?postgres(?:ql)?:.*");
        this.providerMode = providerMode;
        this.openAiApiKey = openAiApiKey;
    }

    public JsonNode getWorld(HttpHeaders headers) {
        if (!postgresDatasource) {
            return invokeBridgeBody("world", headers, null);
        }

        String instanceId = RuntimeWorldHeaderResolver.resolveInstanceId(headers);
        RuntimeWorldRecord record = ensureRuntimeRecord(instanceId);
        return buildWorldSnapshot(record.bundle());
    }

    public JsonNode getInspector(HttpHeaders headers) {
        if (!postgresDatasource) {
            return invokeBridgeBody("inspector", headers, null);
        }

        String instanceId = RuntimeWorldHeaderResolver.resolveInstanceId(headers);
        RuntimeWorldRecord record = ensureRuntimeRecord(instanceId);
        ObjectNode response = objectMapper.createObjectNode();
        response.set("inspector", copyField(record.bundle().worldState(), "lastInspector"));
        return response;
    }

    public JsonNode resetWorld(HttpHeaders headers) {
        if (!postgresDatasource) {
            return invokeBridgeBody("reset", headers, null);
        }

        String instanceId = RuntimeWorldHeaderResolver.resolveInstanceId(headers);
        RuntimeWorldRecord record = withMutationLock(instanceId, () -> {
            Optional<RuntimeWorldRecord> existing = runtimeWorldRepository.findLatest(instanceId);
            RuntimeWorldBundle seedBundle = requestSeedBundle();
            return runtimeWorldRepository.save(
                instanceId,
                seedBundle,
                existing.orElse(null),
                resolveLegacyStoragePath(instanceId)
            );
        });

        return buildWorldSnapshot(record.bundle());
    }

    public JsonNode interact(HttpHeaders headers, Object requestBody) {
        if (!postgresDatasource) {
            return invokeBridgeBody("interact", headers, requestBody);
        }

        String instanceId = RuntimeWorldHeaderResolver.resolveInstanceId(headers);
        JsonNode request = objectMapper.valueToTree(requestBody);

        return withMutationLock(instanceId, () -> {
            RuntimeWorldRecord current = ensureRuntimeRecordLocked(instanceId);
            JsonNode workerResult = requestInteractionWorker(request, current.bundle());
            RuntimeWorldBundle nextBundle = parseBundle(workerResult.path("nextBundle"));
            JsonNode cleanupPaths = workerResult.get("cleanupExportPaths");

            try {
                RuntimeWorldRecord saved = runtimeWorldRepository.save(
                    instanceId,
                    nextBundle,
                    current,
                    resolveLegacyStoragePath(instanceId)
                );
                return buildInteractionResponse(workerResult, saved.bundle());
            } catch (RuntimeException error) {
                cleanupExportArtifacts(cleanupPaths);
                throw error;
            }
        });
    }

    private RuntimeWorldRecord ensureRuntimeRecord(String instanceId) {
        Optional<RuntimeWorldRecord> direct = runtimeWorldRepository.findLatest(instanceId);
        if (direct.isPresent()) {
            return direct.get();
        }

        try {
            return withMutationLock(instanceId, () -> ensureRuntimeRecordLocked(instanceId));
        } catch (RuntimeApiException error) {
            if (error.getStatus() != HttpStatus.CONFLICT) {
                throw error;
            }
        }

        long startedAt = System.currentTimeMillis();
        while (System.currentTimeMillis() - startedAt < READ_WAIT_TIMEOUT_MS) {
            try {
                Thread.sleep(READ_WAIT_INTERVAL_MS);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new RuntimeApiException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "Interrupted while waiting for runtime world state.",
                    error
                );
            }

            Optional<RuntimeWorldRecord> retry = runtimeWorldRepository.findLatest(instanceId);
            if (retry.isPresent()) {
                return retry.get();
            }
        }

        throw new RuntimeApiException(
            HttpStatus.CONFLICT,
            "World state is busy for this instance."
        );
    }

    private RuntimeWorldRecord ensureRuntimeRecordLocked(String instanceId) {
        Optional<RuntimeWorldRecord> existing = runtimeWorldRepository.findLatest(instanceId);
        if (existing.isPresent()) {
            return existing.get();
        }

        RuntimeWorldBundle seedBundle = requestSeedBundle();
        return runtimeWorldRepository.save(
            instanceId,
            seedBundle,
            null,
            resolveLegacyStoragePath(instanceId)
        );
    }

    private RuntimeWorldBundle requestSeedBundle() {
        JsonNode body = invokeBridgeBody("runtime-seed-bundle", new HttpHeaders(), null);

        JsonNode worldState = body.get("worldState");
        JsonNode memoryFile = body.get("memoryFile");
        JsonNode interactionLog = body.get("interactionLog");
        if (worldState == null || memoryFile == null || interactionLog == null) {
            throw new RuntimeApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Seed worker returned an invalid runtime world bundle."
            );
        }

        return new RuntimeWorldBundle(
            worldState.deepCopy(),
            memoryFile.deepCopy(),
            interactionLog.deepCopy()
        );
    }

    private JsonNode invokeBridgeBody(String operation, HttpHeaders headers, Object body) {
        BridgeEnvelope result;
        try {
            result = nodeBridgeService.invoke(operation, headers, body);
        } catch (IllegalStateException error) {
            throw new RuntimeApiException(
                bridgeFailureStatus(error),
                bridgeFailureMessage(error),
                error
            );
        }

        try {
            JsonNode payload = objectMapper.readTree(result.bodyJson());
            if (result.status() >= 400) {
                throw new RuntimeApiException(
                    HttpStatus.valueOf(result.status()),
                    extractMessage(payload, "Runtime bridge request failed.")
                );
            }

            return payload;
        } catch (RuntimeApiException error) {
            throw error;
        } catch (Exception error) {
            throw new RuntimeApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to parse runtime bridge response.",
                error
            );
        }
    }

    private HttpStatus bridgeFailureStatus(IllegalStateException error) {
        String message = error.getMessage();
        if (message != null && message.toLowerCase(Locale.ROOT).contains("timed out")) {
            return HttpStatus.GATEWAY_TIMEOUT;
        }

        return HttpStatus.BAD_GATEWAY;
    }

    private String bridgeFailureMessage(IllegalStateException error) {
        String message = error.getMessage();
        if (message != null && message.toLowerCase(Locale.ROOT).contains("timed out")) {
            return "답변 생성 시간이 초과되었습니다. 잠시 후 다시 시도하거나 NPC_SIMULATOR_BRIDGE_TIMEOUT_SECONDS 값을 늘려주세요.";
        }

        return message == null || message.isBlank()
            ? "Runtime bridge request failed."
            : message;
    }

    private JsonNode requestInteractionWorker(JsonNode request, RuntimeWorldBundle bundle) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.set("request", request.deepCopy());

        ObjectNode bundleNode = payload.putObject("bundle");
        bundleNode.set("worldState", bundle.worldState().deepCopy());
        bundleNode.set("memoryFile", bundle.memoryFile().deepCopy());
        bundleNode.set("interactionLog", bundle.interactionLog().deepCopy());

        return invokeBridgeBody("runtime-interact-worker", new HttpHeaders(), payload);
    }

    private RuntimeWorldBundle parseBundle(JsonNode bundleNode) {
        JsonNode worldState = bundleNode.get("worldState");
        JsonNode memoryFile = bundleNode.get("memoryFile");
        JsonNode interactionLog = bundleNode.get("interactionLog");
        if (worldState == null || memoryFile == null || interactionLog == null) {
            throw new RuntimeApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Interaction worker returned an invalid runtime world bundle."
            );
        }

        return new RuntimeWorldBundle(
            worldState.deepCopy(),
            memoryFile.deepCopy(),
            interactionLog.deepCopy()
        );
    }

    private JsonNode buildInteractionResponse(JsonNode workerResult, RuntimeWorldBundle bundle) {
        ObjectNode response = objectMapper.createObjectNode();
        response.set("reply", copyField(workerResult, "reply"));
        response.set("relationshipDelta", copyField(workerResult, "relationshipDelta"));
        response.set("pressureChanges", copyField(workerResult, "pressureChanges"));
        response.set("eventLogEntry", copyField(workerResult, "eventLogEntry"));
        response.set("inspector", copyField(workerResult, "inspector"));
        response.set("resolution", copyField(workerResult, "resolution"));
        response.set("world", buildWorldSnapshot(bundle));
        return response;
    }

    private void cleanupExportArtifacts(JsonNode pathsNode) {
        if (pathsNode == null || pathsNode.isNull()) {
            return;
        }

        cleanupExportArtifact(pathsNode.get("richTrace"));
        cleanupExportArtifact(pathsNode.get("sft"));
        cleanupExportArtifact(pathsNode.get("review"));
    }

    private void cleanupExportArtifact(JsonNode pathNode) {
        if (pathNode == null || pathNode.isNull()) {
            return;
        }

        Path target = resolveProjectPath(pathNode.asText(""));
        if (target == null) {
            return;
        }

        try {
            Files.deleteIfExists(target);
        } catch (Exception ignored) {
            // Preserve the original DB failure and treat artifact cleanup as best-effort.
        }
    }

    private Path resolveProjectPath(String candidatePath) {
        if (candidatePath == null || candidatePath.isBlank()) {
            return null;
        }

        Path candidate = Path.of(candidatePath);
        if (candidate.isAbsolute()) {
            return candidate.normalize();
        }

        return runtimeLayout.resolveProjectPath(candidatePath);
    }

    private <T> T withMutationLock(String instanceId, RuntimeMutationCallback<T> callback) {
        return transactionTemplate.execute(status -> {
            if (!runtimeWorldRepository.tryAcquireMutationLock(instanceId)) {
                throw new RuntimeApiException(
                    HttpStatus.CONFLICT,
                    "World state is busy for this instance."
                );
            }

            return callback.run();
        });
    }

    private JsonNode buildWorldSnapshot(RuntimeWorldBundle bundle) {
        JsonNode worldState = bundle.worldState();
        JsonNode memoryFile = bundle.memoryFile();
        JsonNode interactionLog = bundle.interactionLog();
        String scenarioId = extractText(worldState, "scenarioId", "underwater-sacrifice");
        RuntimeScenarioCatalog.RuntimeScenarioMetadata scenario =
            runtimeScenarioCatalog.getById(scenarioId);

        ObjectNode snapshot = objectMapper.createObjectNode();
        snapshot.set("scenarioId", textNode(scenario.id()));
        snapshot.set("episodeId", copyField(worldState, "episodeId"));
        snapshot.set("startedAt", copyField(worldState, "startedAt"));
        snapshot.set("endedAt", copyField(worldState, "endedAt"));
        snapshot.set("datasetExportedAt", copyField(worldState, "datasetExportedAt"));
        snapshot.set("exportPaths", copyField(worldState, "exportPaths"));
        snapshot.set("presentation", runtimeScenarioCatalog.presentationNode(scenario));
        snapshot.set("scoring", runtimeScenarioCatalog.scoringNode(scenario));
        snapshot.set("availableActions", runtimeScenarioCatalog.actionsNode(scenario));
        snapshot.set("world", copyField(worldState, "world"));
        snapshot.set("npcs", buildNpcArray(worldState, memoryFile));
        snapshot.set("events", buildEventArray(worldState));
        snapshot.set("conversations", buildConversations(interactionLog));
        snapshot.set("round", copyField(worldState, "round"));
        snapshot.set("consensusBoard", buildConsensusBoard(worldState));
        snapshot.set("lastInspector", copyField(worldState, "lastInspector"));
        snapshot.set("runtime", buildRuntimeStatus());
        snapshot.set("resolution", copyField(worldState, "resolution"));
        return snapshot;
    }

    private ArrayNode buildNpcArray(JsonNode worldState, JsonNode memoryFile) {
        ArrayNode npcs = objectMapper.createArrayNode();
        JsonNode sourceNpcs = worldState.path("npcs");
        JsonNode memories = memoryFile.path("memories");

        if (!sourceNpcs.isArray()) {
            return npcs;
        }

        for (JsonNode npc : sourceNpcs) {
            ObjectNode copy = npc.deepCopy();
            String npcId = npc.path("persona").path("id").asText("");
            JsonNode npcMemories = memories.path(npcId);
            copy.set("memories", npcMemories.isMissingNode() ? objectMapper.createArrayNode() : npcMemories.deepCopy());
            npcs.add(copy);
        }

        return npcs;
    }

    private ArrayNode buildEventArray(JsonNode worldState) {
        List<JsonNode> events = new ArrayList<>();
        for (JsonNode event : iterable(worldState.path("events"))) {
            events.add(event.deepCopy());
        }

        events.sort((left, right) -> extractText(right, "timestamp", "").compareTo(extractText(left, "timestamp", "")));

        ArrayNode output = objectMapper.createArrayNode();
        for (int index = 0; index < Math.min(events.size(), MAX_EVENT_LOG_ENTRIES); index++) {
            output.add(events.get(index));
        }

        return output;
    }

    private ObjectNode buildConversations(JsonNode interactionLog) {
        Map<String, List<JsonNode>> grouped = new LinkedHashMap<>();
        for (JsonNode entry : iterable(interactionLog.path("entries"))) {
            String npcId = extractText(entry, "npcId", "");
            if (!npcId.isBlank()) {
                grouped.computeIfAbsent(npcId, key -> new ArrayList<>()).add(entry);
            }
        }

        ObjectNode conversations = objectMapper.createObjectNode();
        for (Map.Entry<String, List<JsonNode>> groupedEntries : grouped.entrySet()) {
            List<JsonNode> entries = groupedEntries.getValue().stream()
                .sorted(Comparator.comparing(entry -> extractText(entry, "timestamp", "")))
                .collect(Collectors.toList());

            List<JsonNode> messages = new ArrayList<>();
            for (JsonNode entry : entries) {
                messages.add(buildConversationPlayerMessage(entry));
                messages.add(buildConversationNpcMessage(entry));
            }

            int startIndex = Math.max(messages.size() - MAX_CONVERSATION_MESSAGES, 0);
            ArrayNode output = objectMapper.createArrayNode();
            for (int index = startIndex; index < messages.size(); index++) {
                output.add(messages.get(index));
            }

            conversations.set(groupedEntries.getKey(), output);
        }

        return conversations;
    }

    private ObjectNode buildConversationPlayerMessage(JsonNode entry) {
        ObjectNode message = objectMapper.createObjectNode();
        message.put("id", extractText(entry, "id", "") + "-player");
        message.put("npcId", extractText(entry, "npcId", ""));
        message.put("speaker", "player");
        message.put("text", extractText(entry, "playerText", DEFAULT_PLAYER_TEXT));
        message.put("timestamp", extractText(entry, "timestamp", ""));
        JsonNode action = entry.get("playerAction");
        message.set("action", action == null ? NullNode.instance : action.deepCopy());
        return message;
    }

    private ObjectNode buildConversationNpcMessage(JsonNode entry) {
        ObjectNode message = objectMapper.createObjectNode();
        message.put("id", extractText(entry, "id", "") + "-npc");
        message.put("npcId", extractText(entry, "npcId", ""));
        message.put("speaker", "npc");
        message.put("text", extractText(entry, "replyText", ""));
        message.put("timestamp", extractText(entry, "timestamp", ""));
        message.put("fallbackUsed", entry.path("fallbackUsed").asBoolean(false));
        String replyRewriteSource = extractText(entry, "replyRewriteSource", "");
        if (!replyRewriteSource.isBlank()) {
            message.put("replyRewriteSource", replyRewriteSource);
        }
        JsonNode action = entry.get("selectedAction");
        message.set("action", action == null ? NullNode.instance : action.deepCopy());
        return message;
    }

    private ArrayNode buildConsensusBoard(JsonNode worldState) {
        Map<String, String> namesById = new LinkedHashMap<>();
        for (JsonNode npc : iterable(worldState.path("npcs"))) {
            namesById.put(
                npc.path("persona").path("id").asText(""),
                npc.path("persona").path("name").asText("")
            );
        }

        Map<String, Integer> pressureByCandidate = new LinkedHashMap<>();
        Map<String, Integer> topVotesByCandidate = new LinkedHashMap<>();
        Map<String, JsonNode> topChoiceByEvaluator = new LinkedHashMap<>();
        LinkedHashSet<String> candidateIds = new LinkedHashSet<>();

        for (JsonNode judgement : iterable(worldState.path("judgements"))) {
            String candidateId = extractText(judgement, "candidateId", "");
            String evaluatorId = extractText(judgement, "evaluatorNpcId", "");
            int sacrificePreference = judgement.path("sacrificePreference").asInt(0);
            candidateIds.add(candidateId);
            pressureByCandidate.merge(candidateId, sacrificePreference, Integer::sum);

            JsonNode currentTop = topChoiceByEvaluator.get(evaluatorId);
            if (currentTop == null || sacrificePreference > currentTop.path("sacrificePreference").asInt(Integer.MIN_VALUE)) {
                topChoiceByEvaluator.put(evaluatorId, judgement);
            }
        }

        for (JsonNode topChoice : topChoiceByEvaluator.values()) {
            String candidateId = extractText(topChoice, "candidateId", "");
            topVotesByCandidate.merge(candidateId, 1, Integer::sum);
        }

        List<ObjectNode> boardEntries = new ArrayList<>();
        for (String candidateId : candidateIds) {
            int totalPressure = pressureByCandidate.getOrDefault(candidateId, 0);
            int topVotes = topVotesByCandidate.getOrDefault(candidateId, 0);
            String label = DEFAULT_PLAYER_ID.equals(candidateId)
                ? DEFAULT_PLAYER_LABEL
                : namesById.getOrDefault(candidateId, candidateId);

            ObjectNode entry = objectMapper.createObjectNode();
            entry.put("candidateId", candidateId);
            entry.put("candidateLabel", label);
            entry.put("totalPressure", totalPressure);
            entry.put("topVotes", topVotes);
            entry.put("trend", "flat");
            entry.put("summary", pressureSummary(totalPressure));
            boardEntries.add(entry);
        }

        boardEntries.sort((left, right) -> Integer.compare(
            right.path("totalPressure").asInt(0),
            left.path("totalPressure").asInt(0)
        ));

        ArrayNode output = objectMapper.createArrayNode();
        boardEntries.forEach(output::add);
        return output;
    }

    private JsonNode buildRuntimeStatus() {
        ObjectNode status = objectMapper.createObjectNode();

        if ("openai".equals(providerMode)) {
            boolean configured = openAiApiKey != null && !openAiApiKey.isBlank();
            status.put("providerMode", "openai");
            status.put("configured", configured);
            status.put("label", configured ? "OpenAI Responses 사용 가능" : "OPENAI_API_KEY 필요");
            status.put(
                "detail",
                configured
                    ? "OPENAI_API_KEY가 감지되었습니다."
                    : "OPENAI_API_KEY를 설정하면 openai 모드로 전환할 수 있습니다."
            );
            return status;
        }

        if ("deterministic".equals(providerMode)) {
            status.put("providerMode", "deterministic");
            status.put("configured", true);
            status.put("label", "Deterministic fallback 활성화");
            status.put("detail", "외부 모델 호출 없이 규칙 기반 반응으로 스모크와 통합 검증을 수행합니다.");
            return status;
        }

        status.put("providerMode", "codex");
        status.put("configured", true);
        status.put("label", "Codex CLI 사용");
        status.put("detail", "실시간 login status 확인 없이 Codex 실행 경로를 바로 사용합니다.");
        return status;
    }

    private String resolveLegacyStoragePath(String instanceId) {
        Path base = runtimeLayout.dataRoot();
        if (RuntimeWorldHeaderResolver.DEFAULT_WORLD_INSTANCE_ID.equals(instanceId)) {
            return base.toString();
        }

        return base.resolve("runs").resolve(instanceId).toString();
    }

    private JsonNode copyField(JsonNode source, String fieldName) {
        JsonNode value = source.get(fieldName);
        return value == null ? NullNode.instance : value.deepCopy();
    }

    private JsonNode textNode(String value) {
        return value == null ? NullNode.instance : objectMapper.getNodeFactory().textNode(value);
    }

    private String extractText(JsonNode node, String fieldName, String fallback) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return fallback;
        }

        String text = value.asText();
        return text == null || text.isBlank() ? fallback : text;
    }

    private String extractMessage(JsonNode payload, String fallback) {
        JsonNode message = payload.get("message");
        return message == null || message.isNull() ? fallback : message.asText(fallback);
    }

    private String pressureSummary(int totalPressure) {
        if (totalPressure >= 90) {
            return "즉시 희생 가능성 매우 높음";
        }

        if (totalPressure >= 70) {
            return "방 안의 시선이 빠르게 몰리는 중";
        }

        if (totalPressure >= 50) {
            return "위험권 진입";
        }

        return "아직 결정적 고립은 아님";
    }

    private Iterable<JsonNode> iterable(JsonNode node) {
        return node != null && node.isArray() ? node::elements : List.<JsonNode>of();
    }

    @FunctionalInterface
    private interface RuntimeMutationCallback<T> {
        T run();
    }
}
