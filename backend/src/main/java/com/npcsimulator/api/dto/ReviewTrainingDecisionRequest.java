package com.npcsimulator.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record ReviewTrainingDecisionRequest(
    @NotBlank String runId,
    @NotBlank @Pattern(regexp = "accepted|rejected") String decision,
    String reviewer,
    @NotNull String notes
) {}
