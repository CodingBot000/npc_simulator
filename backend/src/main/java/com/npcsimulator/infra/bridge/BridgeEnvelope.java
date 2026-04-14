package com.npcsimulator.infra.bridge;

import com.fasterxml.jackson.databind.JsonNode;

public record BridgeEnvelope(
    int status,
    JsonNode body
) {}
