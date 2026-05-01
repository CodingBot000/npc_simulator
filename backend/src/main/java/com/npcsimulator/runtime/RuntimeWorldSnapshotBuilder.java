package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class RuntimeWorldSnapshotBuilder {

    private static final int MAX_EVENT_LOG_ENTRIES = 12;
    private static final int MAX_CONVERSATION_MESSAGES = 10;
    private static final String DEFAULT_PLAYER_ID = "local-player";
    private static final String DEFAULT_PLAYER_LABEL = "당신";
    private static final String DEFAULT_PLAYER_TEXT =
        "짧게 숨을 고르며 방 안의 시선을 읽었다.";

    private final RuntimeScenarioCatalog runtimeScenarioCatalog;
    private final ObjectMapper objectMapper;
    private final String providerMode;
    private final String openAiApiKey;

    RuntimeWorldSnapshotBuilder(
        RuntimeScenarioCatalog runtimeScenarioCatalog,
        ObjectMapper objectMapper,
        @Value("${LLM_PROVIDER_MODE:codex}") String providerMode,
        @Value("${OPENAI_API_KEY:}") String openAiApiKey
    ) {
        this.runtimeScenarioCatalog = runtimeScenarioCatalog;
        this.objectMapper = objectMapper;
        this.providerMode = providerMode;
        this.openAiApiKey = openAiApiKey;
    }

    JsonNode buildWorldSnapshot(RuntimeWorldBundle bundle) {
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
        snapshot.set("presentation", scenario.presentation().deepCopy());
        snapshot.set("scoring", scenario.scoring().deepCopy());
        snapshot.set("availableActions", scenario.availableActions().deepCopy());
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

    JsonNode buildInspector(RuntimeWorldBundle bundle) {
        ObjectNode response = objectMapper.createObjectNode();
        response.set("inspector", copyField(bundle.worldState(), "lastInspector"));
        return response;
    }

    JsonNode buildInteractionResponse(JsonNode workerResult, RuntimeWorldBundle bundle) {
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
        String replyRewriteReason = extractText(entry, "replyRewriteReason", "");
        if (!replyRewriteReason.isBlank()) {
            message.put("replyRewriteReason", replyRewriteReason);
        }
        JsonNode replyJudge = entry.get("replyJudge");
        if (replyJudge != null && !replyJudge.isNull()) {
            message.set("replyJudge", replyJudge.deepCopy());
        }
        JsonNode failureDebug = entry.get("failureDebug");
        if (failureDebug != null && !failureDebug.isNull()) {
            message.set("failureDebug", failureDebug.deepCopy());
        }
        JsonNode interactionTrace = entry.get("interactionTrace");
        if (interactionTrace != null && !interactionTrace.isNull()) {
            message.set("interactionTrace", interactionTrace.deepCopy());
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
}
