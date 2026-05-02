package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewShadowInvalidJsonQueryService {

    private static final String EPISODE_EXPORT_DIR = "data/datasets/episodes";
    private static final int SHADOW_INVALID_CASE_LIMIT = 8;

    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewDashboardJsonSupport json;
    private final ReviewDashboardFileReader fileReader;

    ReviewShadowInvalidJsonQueryService(
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewDashboardJsonSupport json,
        ReviewDashboardFileReader fileReader
    ) {
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
        this.json = json;
        this.fileReader = fileReader;
    }

    ObjectNode buildShadowInvalidJsonSummary() {
        ObjectNode response = objectMapper.createObjectNode();
        ArrayNode cases = objectMapper.createArrayNode();
        int total = 0;
        String latestExportedAt = null;
        Path episodeDir = commandRunner.resolveProjectPath(EPISODE_EXPORT_DIR);

        if (episodeDir == null || !Files.isDirectory(episodeDir)) {
            response.put("total", 0);
            response.set("latestExportedAt", NullNode.instance);
            response.set("cases", cases);
            return response;
        }

        try (Stream<Path> files = Files.list(episodeDir)) {
            List<Path> episodeFiles = files
                .filter(Files::isRegularFile)
                .filter(path -> path.getFileName().toString().endsWith(".json"))
                .sorted((left, right) -> right.getFileName().toString().compareTo(left.getFileName().toString()))
                .toList();

            for (Path file : episodeFiles) {
                ObjectNode root = json.object(fileReader.loadJsonFile(file));
                ObjectNode episode = json.object(root.get("episode"));
                JsonNode turns = root.get("turns");
                if (turns == null || !turns.isArray()) {
                    continue;
                }

                String exportedAt = json.extractText(episode, "exportedAt");
                if (latestExportedAt == null && exportedAt != null) {
                    latestExportedAt = exportedAt;
                }

                for (JsonNode turnNode : turns) {
                    ObjectNode turn = json.object(turnNode);
                    ObjectNode shadow = json.object(turn.get("shadowComparison"));
                    if (!"invalid_json".equals(json.extractText(shadow, "status"))) {
                        continue;
                    }

                    total += 1;
                    if (cases.size() >= SHADOW_INVALID_CASE_LIMIT) {
                        continue;
                    }

                    cases.add(buildShadowInvalidCase(file, episode, turn, shadow, exportedAt));
                }
            }
        } catch (IOException error) {
            throw new ReviewApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to scan episode exports for shadow invalid JSON cases.",
                error
            );
        }

        response.put("total", total);
        response.set("latestExportedAt", json.nullableTextNode(latestExportedAt));
        response.set("cases", cases);
        return response;
    }

    private ObjectNode buildShadowInvalidCase(
        Path file,
        ObjectNode episode,
        ObjectNode turn,
        ObjectNode shadow,
        String exportedAt
    ) {
        ObjectNode caseNode = objectMapper.createObjectNode();
        caseNode.set("episodeId", json.nullableTextNode(json.extractText(episode, "episodeId")));
        caseNode.put("scenarioId", json.defaultText(json.extractText(episode, "scenarioId"), "unknown-scenario"));
        caseNode.set("turnIndex", json.nullableNumberNode(json.extractNumber(turn, "turnIndex")));
        caseNode.put("npcId", json.defaultText(json.extractText(turn, "npcId"), "unknown"));
        caseNode.set("targetNpcId", json.nullableTextNode(json.extractText(turn, "targetNpcId")));
        caseNode.put(
            "playerText",
            json.defaultText(
                json.firstNonBlank(
                    json.extractText(turn, "rawPlayerText"),
                    json.extractText(turn, "normalizedInputSummary")
                ),
                ""
            )
        );
        caseNode.put("activeReplyText", json.defaultText(json.extractText(turn, "modelReplyText"), ""));
        caseNode.set("shadowLabel", json.nullableTextNode(json.extractText(shadow, "label")));
        caseNode.set("durationMs", json.nullableNumberNode(json.extractNumber(shadow, "durationMs")));
        caseNode.set("sourceRef", json.nullableTextNode(json.extractText(shadow, "sourceRef")));
        caseNode.set("error", json.nullableTextNode(json.extractText(shadow, "error")));
        caseNode.set("rawOutput", json.nullableTextNode(json.extractText(shadow, "rawOutput")));
        caseNode.set(
            "exportPath",
            json.nullableTextNode(commandRunner.requiredRepoRoot().relativize(file.toAbsolutePath().normalize()).toString())
        );
        caseNode.set("exportedAt", json.nullableTextNode(exportedAt));
        return caseNode;
    }
}
