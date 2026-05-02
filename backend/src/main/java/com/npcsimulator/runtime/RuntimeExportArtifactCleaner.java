package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.npcsimulator.infra.runtime.BackendRuntimeLayout;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.stereotype.Component;

@Component
class RuntimeExportArtifactCleaner {

    private final BackendRuntimeLayout runtimeLayout;

    RuntimeExportArtifactCleaner(BackendRuntimeLayout runtimeLayout) {
        this.runtimeLayout = runtimeLayout;
    }

    void cleanupExportArtifacts(JsonNode pathsNode) {
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
}
