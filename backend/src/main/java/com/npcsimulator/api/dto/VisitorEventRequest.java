package com.npcsimulator.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;

public record VisitorEventRequest(
    @NotBlank
    @Size(max = 64)
    @Pattern(regexp = "^[a-z][a-z0-9_:-]*$")
    String eventType,

    @Size(max = 128)
    @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
    String worldInstanceId,

    Map<String, Object> metadata
) {}
