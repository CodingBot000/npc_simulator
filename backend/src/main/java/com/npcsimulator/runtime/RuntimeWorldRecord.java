package com.npcsimulator.runtime;

public record RuntimeWorldRecord(
    long id,
    String instanceId,
    String scenarioId,
    String storagePath,
    int stateVersion,
    String episodeUid,
    RuntimeWorldBundle bundle
) {}
