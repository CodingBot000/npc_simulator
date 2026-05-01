package com.npcsimulator.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record ReviewTrainingRequest(
    @NotBlank @Pattern(regexp = "sft|dpo") String kind
) {}
