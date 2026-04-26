package com.npcsimulator.infra.bridge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.npcsimulator.infra.runtime.BackendRuntimeLayout;
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
    private final BackendRuntimeLayout runtimeLayout;
    private final boolean bridgeEnabled;
    private final long bridgeTimeoutSeconds;
    private final String datasourceUrl;
    private final String datasourceUsername;
    private final String datasourcePassword;

    public NodeBridgeService(
        BackendRuntimeLayout runtimeLayout,
        @Value("${npc-simulator.bridge.enabled:true}") boolean bridgeEnabled,
        @Value("${npc-simulator.bridge.timeout-seconds:420}") long bridgeTimeoutSeconds,
        @Value("${spring.datasource.url:}") String datasourceUrl,
        @Value("${spring.datasource.username:}") String datasourceUsername,
        @Value("${spring.datasource.password:}") String datasourcePassword
    ) {
        this.objectMapper = JsonMapper.builder().findAndAddModules().build();
        this.runtimeLayout = runtimeLayout;
        this.bridgeEnabled = bridgeEnabled;
        this.bridgeTimeoutSeconds = Math.max(1L, bridgeTimeoutSeconds);
        this.datasourceUrl = datasourceUrl;
        this.datasourceUsername = datasourceUsername;
        this.datasourcePassword = datasourcePassword;
    }

    public BridgeEnvelope invoke(String operation, HttpHeaders headers, Object body) {
        if (!bridgeEnabled) {
            return new BridgeEnvelope(
                503,
                "{\"message\":\"Node bridge is disabled.\"}"
            );
        }

        try {
            Path tsxPath = runtimeLayout.tsxBinary();
            if (!Files.isExecutable(tsxPath)) {
                throw new IllegalStateException("tsx executable is missing. Check NPC_SIMULATOR_NODE_BIN_DIR or run npm install.");
            }

            Path scriptPath = runtimeLayout.bridgeScript();
            ProcessBuilder processBuilder = new ProcessBuilder(buildCommand(tsxPath, scriptPath, operation));
            processBuilder.directory(runtimeLayout.workingDirectory().toFile());
            processBuilder.environment().putIfAbsent("NPC_SIMULATOR_ROOT", runtimeLayout.projectRoot().toString());
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
            boolean finished = process.waitFor(bridgeTimeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                destroyProcessTree(process);
                throw new IllegalStateException("Node bridge timed out after " + bridgeTimeoutSeconds + "s.");
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

    private void destroyProcessTree(Process process) {
        process.toHandle().descendants().forEach(ProcessHandle::destroyForcibly);
        process.destroyForcibly();
    }

    private List<String> buildCommand(Path tsxPath, Path scriptPath, String operation) {
        List<String> command = new ArrayList<>();
        command.add(tsxPath.toString());
        command.add(scriptPath.toString());
        command.add(operation);
        return command;
    }
}
