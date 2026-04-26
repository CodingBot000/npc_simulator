package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.npcsimulator.infra.runtime.BackendRuntimeLayout;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.stereotype.Component;

@Component
public class RuntimeScenarioCatalog {

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
            JsonNode actions = requiredArray(metadata, "actions", scenarioId);
            JsonNode scoring = requiredObject(metadata, "scoring", scenarioId);
            String resolvedScenarioId = requiredText(metadata, "id", scenarioId);

            return new RuntimeScenarioMetadata(
                resolvedScenarioId,
                presentation.deepCopy(),
                actions.deepCopy(),
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

    private JsonNode requiredArray(JsonNode source, String fieldName, String scenarioId) {
        JsonNode node = source.path(fieldName);
        if (!node.isArray()) {
            throw new RuntimeApiException(
                org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "Invalid runtime scenario metadata: missing array field '" + fieldName + "' for " + scenarioId
            );
        }
        return node;
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

    public record RuntimeScenarioMetadata(
        String id,
        JsonNode presentation,
        JsonNode availableActions,
        JsonNode scoring
    ) {}
}
