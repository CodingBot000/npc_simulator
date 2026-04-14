package com.npcsimulator.infra.bridge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;

@Service
public class NodeBridgeService {

    private final ObjectMapper objectMapper;
    private final Path repoRoot;
    private final boolean bridgeEnabled;

    public NodeBridgeService(
        ObjectMapper objectMapper,
        @Value("${npc-simulator.bridge.enabled:true}") boolean bridgeEnabled
    ) {
        this.objectMapper = objectMapper;
        this.bridgeEnabled = bridgeEnabled;
        this.repoRoot = resolveRepoRoot();
    }

    public BridgeEnvelope invoke(String operation, HttpHeaders headers, JsonNode body) {
        if (!bridgeEnabled) {
            return new BridgeEnvelope(
                503,
                objectMapper.createObjectNode().put("message", "Node bridge is disabled.")
            );
        }

        try {
            Path tsxPath = repoRoot.resolve("node_modules/.bin/tsx");
            if (!Files.isExecutable(tsxPath)) {
                throw new IllegalStateException("tsx executable is missing. Run npm install at repo root.");
            }

            Path scriptPath = repoRoot.resolve("backend/scripts/api/bridge.ts");
            ProcessBuilder processBuilder = new ProcessBuilder(buildCommand(tsxPath, scriptPath, operation));
            processBuilder.directory(repoRoot.toFile());
            processBuilder.environment().putIfAbsent("NPC_SIMULATOR_ROOT", repoRoot.toString());

            Process process = processBuilder.start();
            var input = objectMapper.createObjectNode();
            input.set("headers", objectMapper.valueToTree(headers.toSingleValueMap()));
            input.set("body", body == null ? objectMapper.nullNode() : body);

            try (var writer = process.outputWriter(StandardCharsets.UTF_8)) {
                writer.write(objectMapper.writeValueAsString(input));
            }

            boolean finished = process.waitFor(2, TimeUnit.MINUTES);
            if (!finished) {
                process.destroyForcibly();
                throw new IllegalStateException("Node bridge timed out.");
            }

            String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8).trim();

            if (process.exitValue() != 0) {
                throw new IllegalStateException(stderr.isBlank() ? stdout : stderr);
            }

            if (stdout.isBlank()) {
                throw new IllegalStateException("Node bridge returned an empty response.");
            }

            return objectMapper.readValue(stdout, BridgeEnvelope.class);
        } catch (IOException | InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Failed to execute node bridge", error);
        }
    }

    private List<String> buildCommand(Path tsxPath, Path scriptPath, String operation) {
        List<String> command = new ArrayList<>();
        command.add(tsxPath.toString());
        command.add(scriptPath.toString());
        command.add(operation);
        return command;
    }

    private Path resolveRepoRoot() {
        String explicit = System.getenv("NPC_SIMULATOR_ROOT");
        if (explicit != null && !explicit.isBlank()) {
            return Path.of(explicit).toAbsolutePath().normalize();
        }

        Path cwd = Path.of("").toAbsolutePath().normalize();
        if (Files.exists(cwd.resolve("frontend")) && Files.exists(cwd.resolve("backend"))) {
            return cwd;
        }

        Path parent = cwd.getParent();
        if (parent != null && Files.exists(parent.resolve("frontend")) && Files.exists(parent.resolve("backend"))) {
            return parent;
        }

        return cwd;
    }
}
