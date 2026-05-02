package com.npcsimulator.review;

record ReviewSnapshotSummary(
    long snapshotId,
    String datasetVersion,
    String fingerprint,
    String manifestPath,
    int rowCount,
    String generatedAt
) {}

