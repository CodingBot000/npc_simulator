package com.npcsimulator.review;

import java.util.List;

record ReviewCommandSpec(String command, List<String> args) {}

record ReviewTrainingCommandBundle(
    ReviewCommandSpec build,
    ReviewCommandSpec train,
    ReviewCommandSpec derive
) {}

record ReviewTrainingRunSpec(
    String runUid,
    String kind,
    String trainingBackend,
    String canonicalModelFamily,
    String fingerprint,
    String sourceFingerprint,
    String sourceDatasetVersion,
    String parentRunUid,
    Long sourceSnapshotId,
    String baseModel,
    String datasetDir,
    String outputRootDir,
    String adapterPath,
    String runtimeArtifactPath,
    String runtimeArtifactKind,
    String remoteProvider,
    String trainingResultPath,
    String logPath,
    ReviewTrainingCommandBundle commands
) {}

record ReviewPromotedBaseline(
    String label,
    String adapterPath,
    String remoteProvider,
    String remoteModelName
) {}

record ReviewTrainingEvaluationWorkerSpec(
    String workerScript,
    String casesPath,
    String provider,
    String judgeModel
) {}
