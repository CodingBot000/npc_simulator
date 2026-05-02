package com.npcsimulator.api.dto;

import java.util.List;

public record SystemInfoResponse(
    String service,
    String status,
    String phase,
    List<String> pendingMigrations,
    String deploymentMode,
    DatabaseInfo database,
    ProviderReadiness provider,
    FinalReplyReadiness finalReply,
    ReviewAccess reviewAccess
) {
    public record DatabaseInfo(
        String kind,
        boolean configured,
        String detail
    ) {}

    public record ProviderReadiness(
        String mode,
        boolean configured,
        String credentialStatus,
        String label,
        String detail,
        String actionGuide
    ) {}

    public record FinalReplyReadiness(
        String mode,
        String backend,
        boolean configured,
        String credentialStatus,
        String label,
        String detail,
        String actionGuide
    ) {}

    public record ReviewAccess(
        boolean readable,
        String writeMode,
        boolean publicWriteEnabled
    ) {}
}
