package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;

public record RuntimeWorldBundle(
    JsonNode worldState,
    JsonNode memoryFile,
    JsonNode interactionLog
) {}
