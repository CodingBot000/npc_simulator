package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
class ReviewDashboardFileReader {

    private final ObjectMapper objectMapper;

    ReviewDashboardFileReader(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    List<JsonNode> loadJsonl(Path path) {
        List<JsonNode> rows = new ArrayList<>();
        if (path == null || !Files.exists(path)) {
            return rows;
        }

        try {
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                String trimmed = line.trim();
                if (!trimmed.isEmpty()) {
                    JsonNode node = objectMapper.readTree(trimmed);
                    if (node.isObject()) {
                        rows.add(node);
                    }
                }
            }
            return rows;
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read review pipeline files.", error);
        }
    }

    JsonNode loadJsonFile(Path path) {
        if (path == null || !Files.exists(path)) {
            return NullNode.instance;
        }

        try {
            return objectMapper.readTree(Files.readString(path, StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read review pipeline summary.", error);
        }
    }
}
