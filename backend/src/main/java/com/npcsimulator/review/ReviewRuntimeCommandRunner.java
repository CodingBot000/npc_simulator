package com.npcsimulator.review;

import com.npcsimulator.infra.bridge.BackendProcessEnvironment;
import com.npcsimulator.infra.runtime.BackendRuntimeLayout;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
class ReviewRuntimeCommandRunner {

    private static final String TSX_RELATIVE_PATH = "node_modules/.bin/tsx";

    private final BackendRuntimeLayout runtimeLayout;
    private final String datasourceUrl;
    private final String datasourceUsername;
    private final String datasourcePassword;

    ReviewRuntimeCommandRunner(
        BackendRuntimeLayout runtimeLayout,
        @Value("${spring.datasource.url:}") String datasourceUrl,
        @Value("${spring.datasource.username:}") String datasourceUsername,
        @Value("${spring.datasource.password:}") String datasourcePassword
    ) {
        this.runtimeLayout = runtimeLayout;
        this.datasourceUrl = datasourceUrl;
        this.datasourceUsername = datasourceUsername;
        this.datasourcePassword = datasourcePassword;
    }

    ProcessResult runNodeCommand(List<String> command) {
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(runtimeLayout.workingDirectory().toFile());
            BackendProcessEnvironment.apply(
                builder.environment(),
                runtimeLayout,
                datasourceUrl,
                datasourceUsername,
                datasourcePassword
            );

            long startedAt = System.currentTimeMillis();
            Process process = builder.start();
            String stdout = readStream(process.getInputStream()).trim();
            String stderr = readStream(process.getErrorStream()).trim();
            int exitCode = process.waitFor();
            long durationMs = System.currentTimeMillis() - startedAt;

            if (exitCode != 0) {
                throw new ReviewApiException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    blank(stderr)
                        ? blankToNull(stdout) != null ? stdout : "worker execution failed"
                        : stderr
                );
            }

            return new ProcessResult(stdout, stderr, durationMs);
        } catch (ReviewApiException error) {
            throw error;
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to execute review worker.", error);
        }
    }

    void startDetachedNodeCommand(List<String> command) {
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(runtimeLayout.workingDirectory().toFile());
            BackendProcessEnvironment.apply(
                builder.environment(),
                runtimeLayout,
                datasourceUrl,
                datasourceUsername,
                datasourcePassword
            );
            builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
            builder.redirectError(ProcessBuilder.Redirect.DISCARD);
            builder.start();
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to launch review worker.", error);
        }
    }

    Path tsxBinary() {
        return runtimeLayout.tsxBinary();
    }

    Path requiredRepoRoot() {
        return runtimeLayout.projectRoot();
    }

    Path resolveRequiredProjectPath(String relativePath) {
        Path path = resolveProjectPath(relativePath);
        if (path == null) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Project path is not available: " + relativePath);
        }
        return path;
    }

    Path resolveScriptsPath(String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            return null;
        }
        return runtimeLayout.resolveScriptsPath(relativePath);
    }

    Path resolveProjectPath(String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            return null;
        }

        Path directPath = Path.of(relativePath);
        if (directPath.isAbsolute()) {
            return directPath.normalize();
        }

        if (TSX_RELATIVE_PATH.equals(relativePath)) {
            return runtimeLayout.tsxBinary();
        }

        if (relativePath.startsWith("node_modules/.bin/")) {
            return runtimeLayout.nodeBinDirectory().resolve(relativePath.substring("node_modules/.bin/".length())).normalize();
        }

        if (relativePath.startsWith("backend/scripts/")) {
            return runtimeLayout.resolveScriptsPath(relativePath.substring("backend/scripts/".length()));
        }

        if (relativePath.startsWith("data/")) {
            return runtimeLayout.resolveDataPath(relativePath.substring("data/".length()));
        }

        if (relativePath.startsWith("outputs/")) {
            return runtimeLayout.resolveOutputsPath(relativePath.substring("outputs/".length()));
        }

        if (relativePath.startsWith(".venv/")) {
            return runtimeLayout.resolveVenvPath(relativePath.substring(".venv/".length()));
        }

        return runtimeLayout.resolveProjectPath(relativePath);
    }

    boolean pathExists(Path path) {
        return path != null && Files.exists(path);
    }

    boolean hasVenvModule(String moduleName) {
        Path libRoot = resolveProjectPath(".venv/lib");
        if (!pathExists(libRoot)) {
            return false;
        }
        try (var children = Files.list(libRoot)) {
            return children
                .filter(Files::isDirectory)
                .map(path -> path.resolve("site-packages"))
                .anyMatch(sitePackages ->
                    pathExists(sitePackages.resolve(moduleName)) ||
                        pathExists(sitePackages.resolve(moduleName + ".py"))
                );
        } catch (IOException ignored) {
            return false;
        }
    }

    private String readStream(InputStream stream) {
        try {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to read worker stream.", error);
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value;
    }

    record ProcessResult(String stdout, String stderr, long durationMs) {}
}
