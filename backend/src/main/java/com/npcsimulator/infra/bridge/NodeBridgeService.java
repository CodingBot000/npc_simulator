package com.npcsimulator.infra.bridge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;

@Service
public class NodeBridgeService {

    private final ObjectMapper objectMapper;
    private final Path repoRoot;
    private final boolean bridgeEnabled;
    private final String datasourceUrl;
    private final String datasourceUsername;
    private final String datasourcePassword;

    public NodeBridgeService(
        @Value("${npc-simulator.bridge.enabled:true}") boolean bridgeEnabled,
        @Value("${spring.datasource.url:}") String datasourceUrl,
        @Value("${spring.datasource.username:}") String datasourceUsername,
        @Value("${spring.datasource.password:}") String datasourcePassword
    ) {
        this.objectMapper = JsonMapper.builder().findAndAddModules().build();
        this.bridgeEnabled = bridgeEnabled;
        this.datasourceUrl = datasourceUrl;
        this.datasourceUsername = datasourceUsername;
        this.datasourcePassword = datasourcePassword;
        this.repoRoot = resolveRepoRoot();
    }

    public BridgeEnvelope invoke(String operation, HttpHeaders headers, Object body) {
        if (!bridgeEnabled) {
            return new BridgeEnvelope(
                503,
                "{\"message\":\"Node bridge is disabled.\"}"
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
            if (datasourceUrl != null && !datasourceUrl.isBlank()) {
                processBuilder.environment().put("SPRING_DATASOURCE_URL", datasourceUrl);
            }
            if (datasourceUsername != null && !datasourceUsername.isBlank()) {
                processBuilder.environment().put("SPRING_DATASOURCE_USERNAME", datasourceUsername);
            }
            if (datasourcePassword != null && !datasourcePassword.isBlank()) {
                processBuilder.environment().put("SPRING_DATASOURCE_PASSWORD", datasourcePassword);
            }

            Process process = processBuilder.start();
            var input = objectMapper.createObjectNode();
            input.set("headers", objectMapper.valueToTree(headers.toSingleValueMap()));
            input.set("body", body == null ? objectMapper.nullNode() : objectMapper.valueToTree(body));

            try (var writer = process.outputWriter(StandardCharsets.UTF_8)) {
                writer.write(objectMapper.writeValueAsString(input));
            }

            CompletableFuture<String> stdoutFuture = readStream(process.getInputStream());
            CompletableFuture<String> stderrFuture = readStream(process.getErrorStream());
            boolean finished = process.waitFor(2, TimeUnit.MINUTES);
            if (!finished) {
                process.destroyForcibly();
                throw new IllegalStateException("Node bridge timed out.");
            }

            String stdout = stdoutFuture.get(5, TimeUnit.SECONDS).trim();
            String stderr = stderrFuture.get(5, TimeUnit.SECONDS).trim();

            if (process.exitValue() != 0) {
                throw new IllegalStateException(stderr.isBlank() ? stdout : stderr);
            }

            if (stdout.isBlank()) {
                throw new IllegalStateException("Node bridge returned an empty response.");
            }

            JsonNode envelope = objectMapper.readTree(stdout);
            JsonNode bodyNode = envelope.path("body");

            return new BridgeEnvelope(
                envelope.path("status").asInt(500),
                bodyNode.isMissingNode() ? "null" : objectMapper.writeValueAsString(bodyNode)
            );
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Failed to execute node bridge", error);
        } catch (ExecutionException | java.util.concurrent.TimeoutException error) {
            throw new IllegalStateException("Failed to read node bridge output", error);
        } catch (IOException error) {
            throw new IllegalStateException("Failed to execute node bridge", error);
        }
    }

    private CompletableFuture<String> readStream(InputStream stream) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException error) {
                throw new IllegalStateException("Failed to read node bridge stream", error);
            }
        });
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
