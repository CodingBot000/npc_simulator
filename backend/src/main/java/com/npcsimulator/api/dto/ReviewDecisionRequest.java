package com.npcsimulator.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record ReviewDecisionRequest(
    @NotBlank @Pattern(regexp = "sft|pair") String kind,
    @NotBlank String reviewId,
    @Pattern(regexp = "include|flip|exclude|escalate") String decision,
    String reviewer,
    String notes
) {}
