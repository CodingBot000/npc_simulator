package com.npcsimulator.review;

import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingRunSpecFactory {

    private final ReviewRepository reviewRepository;
    private final ReviewJsonSupport json;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewSnapshotSummaryService snapshotSummaryService;
    private final ReviewTrainingSettings settings;
    private final ReviewTrainingFingerprintService fingerprintService;

    ReviewTrainingRunSpecFactory(
        ReviewRepository reviewRepository,
        ReviewJsonSupport json,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewSnapshotSummaryService snapshotSummaryService,
        ReviewTrainingSettings settings,
        ReviewTrainingFingerprintService fingerprintService
    ) {
        this.reviewRepository = reviewRepository;
        this.json = json;
        this.commandRunner = commandRunner;
        this.snapshotSummaryService = snapshotSummaryService;
        this.settings = settings;
        this.fingerprintService = fingerprintService;
    }

    ReviewTrainingRunSpec buildTrainingRunSpec(String kind) {
        Optional<ReviewSnapshotSummary> snapshot = snapshotSummaryService.getActiveSnapshotSummary("sft".equals(kind) ? "sft" : "preference");
        if (snapshot.isEmpty()) {
            throw new ReviewApiException(HttpStatus.CONFLICT, "활성 snapshot을 찾지 못했습니다.");
        }

        String runUid = Instant.now().toString().replaceAll("[:.]", "-") + "_" + kind;
        String trainingBackend = settings.currentTrainingBackend();
        Path datasetDir = commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.TRAIN_RUNS_DIR).resolve(runUid).resolve("dataset");
        Path outputRootDir = commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.TRAIN_OUTPUTS_DIR).resolve(runUid);
        Path adapterPath = outputRootDir.resolve("canonical");
        Path runtimeArtifactPath = outputRootDir.resolve("runtime");
        String runtimeArtifactKind = "mlx_fused_model";
        Path trainingResultPath = outputRootDir.resolve("training-result.json");
        Path logPath = commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.TRAIN_RUNS_DIR).resolve(runUid).resolve("worker.log");
        String sourceFingerprint = snapshot.get().fingerprint();
        String remoteProvider = null;

        String parentRunUid = null;
        String fingerprint;
        ReviewRepository.TrainingRunRow latestSftRun = null;
        if ("sft".equals(kind)) {
            fingerprint = fingerprintService.sftFingerprint(snapshot.get());
        } else {
            latestSftRun = reviewRepository.findLatestSuccessfulTrainingRun("sft")
                .orElseThrow(() -> new ReviewApiException(HttpStatus.CONFLICT, "먼저 성공한 SFT 학습 결과가 있어야 DPO를 실행할 수 있습니다."));
            parentRunUid = latestSftRun.runUid();
            fingerprint = fingerprintService.dpoFingerprint(snapshot.get(), latestSftRun);
        }

        ReviewCommandSpec buildCommand;
        ReviewCommandSpec trainCommand;
        ReviewCommandSpec deriveCommand = null;
        if (settings.isSmokeTrainingMode()) {
            Path mockScriptPath = commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.MOCK_TRAINING_SCRIPT);
            buildCommand = new ReviewCommandSpec(
                commandRunner.tsxBinary().toString(),
                List.of(
                    mockScriptPath.toString(),
                    "--mode",
                    "sft".equals(kind) ? "build_sft" : "build_dpo",
                    "--output-dir",
                    datasetDir.toString(),
                    "--snapshot-id",
                    String.valueOf(snapshot.get().snapshotId())
                )
            );
            ArrayList<String> smokeTrainArgs = new ArrayList<>(List.of(
                mockScriptPath.toString(),
                "--mode",
                "sft".equals(kind) ? "train_sft" : "train_dpo",
                "--adapter-path",
                adapterPath.toString(),
                "--runtime-artifact-path",
                runtimeArtifactPath.toString(),
                "--runtime-artifact-kind",
                runtimeArtifactKind,
                "--manifest-path",
                trainingResultPath.toString(),
                "--dataset-dir",
                datasetDir.toString(),
                "--canonical-model-family",
                settings.canonicalModelFamily(),
                "--run-id",
                runUid
            ));
            if (!"sft".equals(kind) && latestSftRun != null && !json.blank(latestSftRun.outputAdapterPath())) {
                smokeTrainArgs.add("--reference-adapter-path");
                smokeTrainArgs.add(latestSftRun.outputAdapterPath());
            }
            trainCommand = new ReviewCommandSpec(commandRunner.tsxBinary().toString(), smokeTrainArgs);
            deriveCommand = new ReviewCommandSpec(
                commandRunner.tsxBinary().toString(),
                List.of(
                    mockScriptPath.toString(),
                    "--mode",
                    "derive_runtime",
                    "--adapter-path",
                    adapterPath.toString(),
                    "--runtime-artifact-path",
                    runtimeArtifactPath.toString(),
                    "--runtime-artifact-kind",
                    runtimeArtifactKind,
                    "--manifest-path",
                    trainingResultPath.toString(),
                    "--canonical-model-family",
                    settings.canonicalModelFamily(),
                    "--run-id",
                    runUid
                )
            );
        } else if (settings.isTogetherTrainingMode()) {
            if (!"sft".equals(kind)) {
                throw new ReviewApiException(HttpStatus.CONFLICT, "Together serverless LoRA 전환 1차에서는 DPO를 지원하지 않습니다.");
            }
            buildCommand = new ReviewCommandSpec(
                commandRunner.tsxBinary().toString(),
                List.of(
                    commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.EXPORT_TOGETHER_SFT_SCRIPT).toString(),
                    "--snapshot-id",
                    String.valueOf(snapshot.get().snapshotId()),
                    "--output-dir",
                    datasetDir.toString(),
                    "--input-format",
                    "compact",
                    "--assistant-format",
                    "reply_text"
                )
            );
            trainCommand = new ReviewCommandSpec(
                commandRunner.tsxBinary().toString(),
                List.of(
                    commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.TRAINING_WORKER_SCRIPT).toString(),
                    "--run-id",
                    runUid,
                    "--remote-backend",
                    ReviewTrainingSettings.TOGETHER_REMOTE_PROVIDER
                )
            );
            remoteProvider = ReviewTrainingSettings.TOGETHER_REMOTE_PROVIDER;
            adapterPath = null;
            runtimeArtifactPath = null;
            runtimeArtifactKind = null;
        } else {
            buildCommand = "sft".equals(kind)
                ? new ReviewCommandSpec(
                    commandRunner.tsxBinary().toString(),
                    List.of(
                        commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.EXPORT_MLX_SFT_SCRIPT).toString(),
                        "--snapshot-id",
                        String.valueOf(snapshot.get().snapshotId()),
                        "--output-dir",
                        datasetDir.toString(),
                        "--input-format",
                        "compact",
                        "--assistant-format",
                        "reply_text"
                    )
                )
                : new ReviewCommandSpec(
                    commandRunner.tsxBinary().toString(),
                    List.of(
                        commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.BUILD_MLX_DPO_SCRIPT).toString(),
                        "--snapshot-id",
                        String.valueOf(snapshot.get().snapshotId()),
                        "--output-dir",
                        datasetDir.toString()
                    )
                );

            trainCommand = "sft".equals(kind)
                ? new ReviewCommandSpec(
                    commandRunner.resolveRequiredProjectPath(".venv/bin/python").toString(),
                    List.of(
                        commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.TRAIN_PEFT_SFT_SCRIPT).toString(),
                        "--model",
                        settings.trainingBaseModel(),
                        "--data-dir",
                        datasetDir.toString(),
                        "--output-dir",
                        adapterPath.toString(),
                        "--iters",
                        String.valueOf(settings.sftIters()),
                        "--batch-size",
                        String.valueOf(settings.sftBatchSize()),
                        "--learning-rate",
                        settings.sftLearningRate(),
                        "--max-seq-length",
                        String.valueOf(settings.sftMaxSeqLength())
                    )
                )
                : new ReviewCommandSpec(
                    commandRunner.resolveRequiredProjectPath(".venv/bin/python").toString(),
                    List.of(
                        commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.TRAIN_PEFT_DPO_SCRIPT).toString(),
                        "--model",
                        settings.trainingBaseModel(),
                        "--data-dir",
                        datasetDir.toString(),
                        "--reference-adapter-dir",
                        latestSftRun.outputAdapterPath(),
                        "--output-dir",
                        adapterPath.toString(),
                        "--iters",
                        String.valueOf(settings.dpoIters()),
                        "--batch-size",
                        String.valueOf(settings.dpoBatchSize()),
                        "--learning-rate",
                        settings.dpoLearningRate(),
                        "--num-layers",
                        String.valueOf(settings.dpoNumLayers()),
                        "--steps-per-report",
                        String.valueOf(settings.dpoStepsPerReport()),
                        "--steps-per-eval",
                        String.valueOf(settings.dpoStepsPerEval()),
                        "--save-every",
                        String.valueOf(settings.dpoSaveEvery()),
                        "--beta",
                        settings.dpoBeta(),
                        "--max-seq-length",
                        String.valueOf(settings.dpoMaxSeqLength())
                    )
                );
            deriveCommand = new ReviewCommandSpec(
                commandRunner.resolveRequiredProjectPath(".venv/bin/python").toString(),
                List.of(
                    commandRunner.resolveRequiredProjectPath(ReviewTrainingSettings.DERIVE_MLX_RUNTIME_SCRIPT).toString(),
                    "--model",
                    settings.trainingBaseModel(),
                    "--canonical-model-family",
                    settings.canonicalModelFamily(),
                    "--runtime-base-model",
                    settings.localReplyMlxModel(),
                    "--adapter-dir",
                    adapterPath.toString(),
                    "--output-dir",
                    runtimeArtifactPath.toString(),
                    "--runtime-kind",
                    runtimeArtifactKind,
                    "--manifest-path",
                    trainingResultPath.toString()
                )
            );
        }

        return new ReviewTrainingRunSpec(
            runUid,
            kind,
            trainingBackend,
            settings.canonicalModelFamily(),
            fingerprint,
            sourceFingerprint,
            snapshot.get().datasetVersion(),
            parentRunUid,
            snapshot.get().snapshotId(),
            settings.trainingBaseModel(),
            datasetDir.toString(),
            outputRootDir.toString(),
            adapterPath == null ? null : adapterPath.toString(),
            runtimeArtifactPath == null ? null : runtimeArtifactPath.toString(),
            runtimeArtifactKind,
            remoteProvider,
            trainingResultPath.toString(),
            logPath.toString(),
            new ReviewTrainingCommandBundle(buildCommand, trainCommand, deriveCommand)
        );
    }
}
