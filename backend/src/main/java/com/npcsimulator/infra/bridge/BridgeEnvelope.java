package com.npcsimulator.infra.bridge;

public record BridgeEnvelope(
    int status,
    String bodyJson
) {}
