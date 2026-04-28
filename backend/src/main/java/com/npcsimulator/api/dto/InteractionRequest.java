package com.npcsimulator.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record InteractionRequest(
    @NotBlank String npcId,
    String targetNpcId,
    @NotNull @Pattern(regexp = "free_text|action|combined") String inputMode,
    @NotNull String text,
    @Pattern(regexp = "make_case|expose|appeal|ally|deflect|stall|confess") String action,
    @NotBlank String playerId
) {}
