package com.npcsimulator.review;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingLogService {

    private final ReviewRuntimeCommandRunner commandRunner;

    ReviewTrainingLogService(ReviewRuntimeCommandRunner commandRunner) {
        this.commandRunner = commandRunner;
    }

    ReviewRuntimeCommandRunner.ProcessResult runLoggedCommand(ReviewCommandSpec command, String logPath) {
        appendLog(logPath, "\n$ " + commandToString(command) + "\n");
        ReviewRuntimeCommandRunner.ProcessResult result = commandRunner.runNodeCommand(commandToList(command));
        if (blankToNull(result.stdout()) != null) {
            appendLog(logPath, result.stdout() + "\n");
        }
        if (blankToNull(result.stderr()) != null) {
            appendLog(logPath, result.stderr() + "\n");
        }
        return result;
    }

    void appendLog(String logPath, String text) {
        try {
            Path path = Path.of(logPath);
            Files.createDirectories(path.getParent());
            Files.writeString(
                path,
                text,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
            );
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to append training log.", error);
        }
    }

    void writeInitialTrainingLog(ReviewTrainingRunSpec spec) {
        try {
            Path logPath = Path.of(spec.logPath());
            Files.createDirectories(logPath.getParent());
            Files.createDirectories(Path.of(spec.outputRootDir()));
            String content = String.join(
                "\n",
                "runId=" + spec.runUid(),
                "kind=" + spec.kind(),
                "trainingBackend=" + spec.trainingBackend(),
                "build=" + commandToString(spec.commands().build()),
                "train=" + commandToString(spec.commands().train()),
                "derive=" + commandToString(spec.commands().derive()),
                ""
            );
            Files.writeString(
                logPath,
                content,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
            );
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to initialize training log.", error);
        }
    }

    private String commandToString(ReviewCommandSpec command) {
        if (command == null) {
            return "-";
        }
        List<String> parts = new ArrayList<>();
        parts.add(command.command());
        parts.addAll(command.args());
        return parts.stream()
            .map(entry -> entry.contains(" ") ? "\"" + entry + "\"" : entry)
            .reduce((left, right) -> left + " " + right)
            .orElse("");
    }

    private List<String> commandToList(ReviewCommandSpec command) {
        ArrayList<String> parts = new ArrayList<>();
        parts.add(command.command());
        parts.addAll(command.args());
        return parts;
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value;
    }
}
