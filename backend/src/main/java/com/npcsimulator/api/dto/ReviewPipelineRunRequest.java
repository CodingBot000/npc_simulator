package com.npcsimulator.api.dto;

import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Pattern;

public record ReviewPipelineRunRequest(
    @Pattern(regexp = "human_required|human_reviewed|llm_completed") String sourceMode,
    @Pattern(regexp = "heuristic|llm|hybrid") String mode,
    @Pattern(regexp = "codex|openai") String provider,
    @Positive Integer limit,
    Boolean dryRun,
    Boolean verbose,
    String input,
    String output,
    String reviewInput,
    String pairsInput,
    String collectorInput,
    String outputDir,
    Boolean skipDbSync,
    String sftInput,
    String pairInput
) {
    public static ReviewPipelineRunRequest empty() {
        return new ReviewPipelineRunRequest(
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
        );
    }
}
