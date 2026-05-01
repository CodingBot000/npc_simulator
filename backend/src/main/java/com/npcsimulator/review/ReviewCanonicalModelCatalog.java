package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
class ReviewCanonicalModelCatalog {

    private static final String CANONICAL_MODEL_FAMILIES_PATH =
        "server/config/canonical-model-families.json";

    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;

    ReviewCanonicalModelCatalog(
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner
    ) {
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
    }

    CanonicalModelDefaults resolve(String configuredFamilyId) {
        Path catalogPath = commandRunner.resolveScriptsPath(CANONICAL_MODEL_FAMILIES_PATH);
        if (catalogPath == null || !Files.exists(catalogPath)) {
            throw new ReviewApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "canonical model catalog not found: " + CANONICAL_MODEL_FAMILIES_PATH
            );
        }

        try {
            JsonNode root = objectMapper.readTree(Files.readString(catalogPath, StandardCharsets.UTF_8));
            String defaultFamilyId = extractText(root, "defaultFamily");
            if (blank(defaultFamilyId)) {
                throw new ReviewApiException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "canonical model catalog missing defaultFamily"
                );
            }

            String familyId = blank(configuredFamilyId) ? defaultFamilyId : configuredFamilyId.trim();
            ObjectNode families = object(root.get("families"));
            ObjectNode familyNode = object(families.get(familyId));
            if (familyNode.isEmpty()) {
                throw new ReviewApiException(
                    HttpStatus.BAD_REQUEST,
                    "unsupported CANONICAL_MODEL_FAMILY: " + familyId
                );
            }

            return new CanonicalModelDefaults(
                familyId,
                requireText(familyNode, "localTrainingBaseModelId"),
                requireText(familyNode, "localReplyMlxModelId"),
                requireText(familyNode, "remoteTrainingBaseModelId")
            );
        } catch (IOException error) {
            throw new ReviewApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "failed to load canonical model catalog",
                error
            );
        }
    }

    private String requireText(ObjectNode node, String fieldName) {
        String value = extractText(node, fieldName);
        if (blank(value)) {
            throw new ReviewApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "canonical model catalog missing field: " + fieldName
            );
        }
        return value;
    }

    private ObjectNode object(JsonNode value) {
        if (value instanceof ObjectNode objectNode) {
            return objectNode;
        }
        return objectMapper.createObjectNode();
    }

    private String extractText(JsonNode node, String fieldName) {
        JsonNode value = node == null ? null : node.get(fieldName);
        return value != null && value.isTextual() ? value.asText() : null;
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    record CanonicalModelDefaults(
        String familyId,
        String localTrainingBaseModelId,
        String localReplyMlxModelId,
        String remoteTrainingBaseModelId
    ) {}
}
