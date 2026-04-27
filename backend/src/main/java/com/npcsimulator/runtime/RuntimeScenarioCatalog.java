package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.npcsimulator.infra.runtime.BackendRuntimeLayout;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class RuntimeScenarioCatalog {
    private static final String PLAYER_ACTIONS_PATH =
        "shared/simulator-presentation/player-actions.json";

    private final ObjectMapper objectMapper;
    private final BackendRuntimeLayout runtimeLayout;

    public RuntimeScenarioCatalog(
        ObjectMapper objectMapper,
        BackendRuntimeLayout runtimeLayout
    ) {
        this.objectMapper = objectMapper;
        this.runtimeLayout = runtimeLayout;
    }

    public RuntimeScenarioMetadata getById(String scenarioId) {
        Path metadataPath = runtimeLayout
            .scriptsRoot()
            .resolve("server")
            .resolve("scenario")
            .resolve(scenarioId)
            .resolve("metadata.json")
            .normalize();

        if (!Files.exists(metadataPath)) {
            throw new RuntimeApiException(
                org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "Unsupported runtime scenario: " + scenarioId
            );
        }

        try {
            JsonNode metadata = objectMapper.readTree(Files.readString(metadataPath));
            JsonNode presentation = requiredObject(metadata, "presentation", scenarioId);
            ArrayNode actionIds = requiredArray(metadata, "actionIds", scenarioId);
            JsonNode scoring = requiredObject(metadata, "scoring", scenarioId);
            String resolvedScenarioId = requiredText(metadata, "id", scenarioId);

            return new RuntimeScenarioMetadata(
                resolvedScenarioId,
                presentation.deepCopy(),
                buildActionDefinitions(actionIds, scenarioId),
                scoring.deepCopy()
            );
        } catch (IOException error) {
            throw new RuntimeApiException(
                org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to load runtime scenario metadata: " + scenarioId,
                error
            );
        }
    }

    private JsonNode requiredObject(JsonNode source, String fieldName, String scenarioId) {
        JsonNode node = source.path(fieldName);
        if (!node.isObject()) {
            throw new RuntimeApiException(
                org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "Invalid runtime scenario metadata: missing object field '" + fieldName + "' for " + scenarioId
            );
        }
        return node;
    }

    private ArrayNode requiredArray(JsonNode source, String fieldName, String scenarioId) {
        JsonNode node = source.path(fieldName);
        if (!node.isArray()) {
            throw new RuntimeApiException(
                org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "Invalid runtime scenario metadata: missing array field '" + fieldName + "' for " + scenarioId
            );
        }
        return (ArrayNode) node;
    }

    private String requiredText(JsonNode source, String fieldName, String scenarioId) {
        JsonNode node = source.path(fieldName);
        if (!node.isTextual() || node.asText().isBlank()) {
            throw new RuntimeApiException(
                org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "Invalid runtime scenario metadata: missing text field '" + fieldName + "' for " + scenarioId
            );
        }
        return node.asText();
    }

    private ArrayNode buildActionDefinitions(ArrayNode actionIds, String scenarioId) throws IOException {
        Path playerActionsPath = runtimeLayout
            .projectRoot()
            .resolve(PLAYER_ACTIONS_PATH)
            .normalize();
        if (!Files.exists(playerActionsPath)) {
            throw new RuntimeApiException(
                org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "Missing shared player action metadata: " + PLAYER_ACTIONS_PATH
            );
        }

        JsonNode playerActionsNode = objectMapper.readTree(Files.readString(playerActionsPath));
        if (!playerActionsNode.isArray()) {
            throw new RuntimeApiException(
                org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "Invalid shared player action metadata: expected array"
            );
        }

        Map<String, JsonNode> playerActionsById = new LinkedHashMap<>();
        for (JsonNode actionNode : playerActionsNode) {
            String actionId = requiredText(actionNode, "id", scenarioId);
            playerActionsById.put(actionId, actionNode);
        }

        ArrayNode actions = objectMapper.createArrayNode();
        for (JsonNode actionIdNode : actionIds) {
            if (!actionIdNode.isTextual() || actionIdNode.asText().isBlank()) {
                throw new RuntimeApiException(
                    org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                    "Invalid runtime scenario metadata: actionIds must be non-empty strings for " + scenarioId
                );
            }

            String actionId = actionIdNode.asText();
            JsonNode actionRecord = playerActionsById.get(actionId);
            if (actionRecord == null) {
                throw new RuntimeApiException(
                    org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                    "Unknown player action id '" + actionId + "' for " + scenarioId
                );
            }

            String targetMode = requiredText(actionRecord, "targetMode", scenarioId);
            ObjectNode action = objectMapper.createObjectNode();
            action.put("id", actionId);
            action.put("label", requiredText(actionRecord, "label", scenarioId));
            action.put("description", requiredText(actionRecord, "description", scenarioId));
            action.put("requiresTarget", "required".equals(targetMode));
            actions.add(action);
        }

        return actions;
    }

    public record RuntimeScenarioMetadata(
        String id,
        JsonNode presentation,
        JsonNode availableActions,
        JsonNode scoring
    ) {}
}
