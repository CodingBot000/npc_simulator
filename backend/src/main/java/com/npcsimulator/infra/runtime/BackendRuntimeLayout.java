package com.npcsimulator.infra.runtime;

import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class BackendRuntimeLayout {

    private final Path projectRoot;
    private final Path workingDirectory;
    private final Path scriptsRoot;
    private final Path nodeBinDirectory;
    private final Path dataRoot;
    private final Path outputsRoot;
    private final Path venvRoot;

    public BackendRuntimeLayout(
        @Value("${npc-simulator.runtime.project-root:}") String configuredProjectRoot,
        @Value("${npc-simulator.runtime.workdir:}") String configuredWorkingDirectory,
        @Value("${npc-simulator.runtime.scripts-root:}") String configuredScriptsRoot,
        @Value("${npc-simulator.runtime.node-bin-dir:}") String configuredNodeBinDirectory,
        @Value("${npc-simulator.runtime.data-root:}") String configuredDataRoot,
        @Value("${npc-simulator.runtime.outputs-root:}") String configuredOutputsRoot,
        @Value("${npc-simulator.runtime.venv-root:}") String configuredVenvRoot
    ) {
        this.projectRoot = resolveProjectRoot(
            configuredProjectRoot,
            configuredWorkingDirectory,
            configuredScriptsRoot,
            configuredDataRoot,
            configuredOutputsRoot,
            configuredVenvRoot
        );
        this.workingDirectory = resolvePath(configuredWorkingDirectory, projectRoot);
        this.scriptsRoot = resolvePath(configuredScriptsRoot, projectRoot.resolve("backend").resolve("scripts"));
        this.nodeBinDirectory = resolvePath(configuredNodeBinDirectory, projectRoot.resolve("node_modules").resolve(".bin"));
        this.dataRoot = resolvePath(configuredDataRoot, projectRoot.resolve("data"));
        this.outputsRoot = resolvePath(configuredOutputsRoot, projectRoot.resolve("outputs"));
        this.venvRoot = resolvePath(configuredVenvRoot, projectRoot.resolve(".venv"));
    }

    public Path projectRoot() {
        return projectRoot;
    }

    public Path workingDirectory() {
        return workingDirectory;
    }

    public Path scriptsRoot() {
        return scriptsRoot;
    }

    public Path nodeBinDirectory() {
        return nodeBinDirectory;
    }

    public Path dataRoot() {
        return dataRoot;
    }

    public Path outputsRoot() {
        return outputsRoot;
    }

    public Path venvRoot() {
        return venvRoot;
    }

    public Path tsxBinary() {
        return nodeBinDirectory.resolve("tsx").normalize();
    }

    public Path bridgeScript() {
        return scriptsRoot.resolve("api").resolve("bridge.ts").normalize();
    }

    public Path resolveProjectPath(String candidatePath) {
        return resolveRelative(projectRoot, candidatePath);
    }

    public Path resolveScriptsPath(String candidatePath) {
        return resolveRelative(scriptsRoot, candidatePath);
    }

    public Path resolveDataPath(String candidatePath) {
        return resolveRelative(dataRoot, candidatePath);
    }

    public Path resolveOutputsPath(String candidatePath) {
        return resolveRelative(outputsRoot, candidatePath);
    }

    public Path resolveVenvPath(String candidatePath) {
        return resolveRelative(venvRoot, candidatePath);
    }

    private Path resolveProjectRoot(
        String configuredProjectRoot,
        String configuredWorkingDirectory,
        String configuredScriptsRoot,
        String configuredDataRoot,
        String configuredOutputsRoot,
        String configuredVenvRoot
    ) {
        Path explicitProjectRoot = trimToPath(configuredProjectRoot);
        if (explicitProjectRoot != null) {
            return explicitProjectRoot;
        }

        Path scriptsRootCandidate = trimToPath(configuredScriptsRoot);
        if (scriptsRootCandidate != null) {
            Path candidate = scriptsRootCandidate.getParent();
            if (candidate != null) {
                Path parent = candidate.getParent();
                if (parent != null) {
                    return parent.normalize();
                }
            }
        }

        for (String configuredPath : new String[] {
            configuredWorkingDirectory,
            configuredDataRoot,
            configuredOutputsRoot,
            configuredVenvRoot,
        }) {
            Path candidate = trimToPath(configuredPath);
            if (looksLikeProjectRoot(candidate)) {
                return candidate.normalize();
            }
            if (candidate != null) {
                Path parent = candidate.getParent();
                if (looksLikeProjectRoot(parent)) {
                    return parent.normalize();
                }
            }
        }

        Path cwd = Path.of("").toAbsolutePath().normalize();
        if (looksLikeProjectRoot(cwd)) {
            return cwd;
        }

        Path parent = cwd.getParent();
        if (looksLikeProjectRoot(parent)) {
            return parent.normalize();
        }

        return cwd;
    }

    private Path resolvePath(String configuredPath, Path fallback) {
        Path explicit = trimToPath(configuredPath);
        return explicit != null ? explicit : fallback.toAbsolutePath().normalize();
    }

    private Path resolveRelative(Path root, String candidatePath) {
        if (candidatePath == null || candidatePath.isBlank()) {
            return null;
        }

        Path candidate = Path.of(candidatePath);
        if (candidate.isAbsolute()) {
            return candidate.normalize();
        }

        return root.resolve(candidate).normalize();
    }

    private Path trimToPath(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }

        return Path.of(trimmed).toAbsolutePath().normalize();
    }

    private boolean looksLikeProjectRoot(Path candidate) {
        return candidate != null &&
            Files.exists(candidate.resolve("backend")) &&
            Files.exists(candidate.resolve("frontend"));
    }
}
