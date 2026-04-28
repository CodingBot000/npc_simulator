package com.npcsimulator.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record ReviewTrainingRunActionRequest(
    @NotBlank String runId,
    @Pattern(regexp = "default|doctor|supervisor|director") String bindingKey
) {}
