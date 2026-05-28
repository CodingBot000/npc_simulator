package com.npcsimulator.api.dto;

import jakarta.validation.constraints.NotBlank;

public record OwnerRegistrationRequest(
    @NotBlank String token
) {}
