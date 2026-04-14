package com.npcsimulator.api.dto;

import java.util.List;

public record SystemInfoResponse(
    String service,
    String status,
    String phase,
    List<String> pendingMigrations
) {}
