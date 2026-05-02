package com.npcsimulator.review;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingPreflightService {

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewJsonSupport json;
    private final ReviewRuntimeCommandRunner commandRunner;
    private final ReviewFinalizeService finalizeService;
    private final ReviewSnapshotSummaryService snapshotSummaryService;
    private final ReviewTrainingSettings settings;
    private final ReviewTrainingFingerprintService fingerprintService;

    ReviewTrainingPreflightService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewJsonSupport json,
        ReviewRuntimeCommandRunner commandRunner,
        ReviewFinalizeService finalizeService,
        ReviewSnapshotSummaryService snapshotSummaryService,
        ReviewTrainingSettings settings,
        ReviewTrainingFingerprintService fingerprintService
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.json = json;
        this.commandRunner = commandRunner;
        this.finalizeService = finalizeService;
        this.snapshotSummaryService = snapshotSummaryService;
        this.settings = settings;
        this.fingerprintService = fingerprintService;
    }

    ObjectNode buildSftPreflight() {
        ObjectNode preflight = emptyPreflight("sft");
        ArrayNode blockingIssues = objectMapper.createArrayNode();
        blockingIssues.addAll(finalizeService.getFinalizeBlockingIssues());
        preflight.put("executionMode", settings.currentTrainingBackend());
        preflight.put("trainingBackend", settings.currentTrainingBackend());

        Optional<ReviewSnapshotSummary> dataset = snapshotSummaryService.getActiveSnapshotSummary("sft");
        preflight.set("dataset", datasetNode(dataset));

        if (
            !commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.TSX_RELATIVE_PATH)) ||
            !commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.TRAINING_WORKER_SCRIPT))
        ) {
            blockingIssues.add("training worker 실행 파일이 없어 SFT 학습을 시작할 수 없습니다.");
        }
        if (settings.isSmokeTrainingMode()) {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.MOCK_TRAINING_SCRIPT))) {
                blockingIssues.add("training smoke script가 없어 SFT 학습 smoke 실행을 시작할 수 없습니다.");
            }
        } else if (settings.isTogetherTrainingMode()) {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.EXPORT_TOGETHER_SFT_SCRIPT))) {
                blockingIssues.add("Together SFT dataset exporter 스크립트가 없습니다.");
            }
        } else {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(".venv/bin/python"))) {
                blockingIssues.add("`.venv/bin/python`이 없어 PEFT SFT 학습을 실행할 수 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.TRAIN_PEFT_SFT_SCRIPT))) {
                blockingIssues.add("PEFT SFT trainer 스크립트가 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.DERIVE_MLX_RUNTIME_SCRIPT))) {
                blockingIssues.add("MLX runtime 파생 스크립트가 없습니다.");
            }
            List<String> missingModules = Stream.of("torch", "transformers", "peft", "datasets", "mlx_lm")
                .filter(module -> !commandRunner.hasVenvModule(module))
                .toList();
            if (!missingModules.isEmpty()) {
                blockingIssues.add(missingModuleMessage(missingModules));
            }
        }
        if (dataset.isEmpty() || dataset.get().rowCount() <= 0) {
            blockingIssues.add("최종 SFT 데이터셋이 없거나 비어 있습니다.");
        }

        String fingerprint = dataset.map(fingerprintService::sftFingerprint).orElse(null);
        Optional<ReviewRepository.TrainingRunRow> duplicate = fingerprint == null
            ? Optional.empty()
            : reviewRepository.findTrainingRunByFingerprint("sft", fingerprint);

        preflight.put("alreadyTrained", duplicate.map(row -> "succeeded".equals(row.state())).orElse(false));
        preflight.set("duplicateRunId", json.nullableTextNode(duplicate.map(ReviewRepository.TrainingRunRow::runUid).orElse(null)));
        if (duplicate.isPresent()) {
            blockingIssues.add(
                "running".equals(duplicate.get().state())
                    ? "같은 SFT 학습이 이미 실행 중입니다. runId=" + duplicate.get().runUid()
                    : "같은 SFT 데이터와 설정으로 이미 학습했습니다. runId=" + duplicate.get().runUid()
            );
        }
        preflight.set("blockingIssues", blockingIssues);
        preflight.put("canStart", dataset.isPresent() && dataset.get().rowCount() > 0 && fingerprint != null && blockingIssues.isEmpty());
        return preflight;
    }

    ObjectNode buildDpoPreflight(ObjectNode sftPreflight) {
        ObjectNode preflight = emptyPreflight("dpo");
        ArrayNode blockingIssues = objectMapper.createArrayNode();
        blockingIssues.addAll(finalizeService.getFinalizeBlockingIssues());
        preflight.put("trainingBackend", settings.currentTrainingBackend());

        Optional<ReviewSnapshotSummary> dataset = snapshotSummaryService.getActiveSnapshotSummary("preference");
        preflight.set("dataset", datasetNode(dataset));

        if (settings.isTogetherTrainingMode()) {
            preflight.put("executionMode", "unsupported");
            blockingIssues.add("Together serverless LoRA 전환 1차에서는 DPO를 지원하지 않습니다.");
            preflight.set("blockingIssues", blockingIssues);
            preflight.put("canStart", false);
            return preflight;
        }

        if (
            !commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.TSX_RELATIVE_PATH)) ||
            !commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.TRAINING_WORKER_SCRIPT))
        ) {
            blockingIssues.add("training worker 실행 파일이 없어 DPO 학습을 시작할 수 없습니다.");
        }
        if (settings.isSmokeTrainingMode()) {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.MOCK_TRAINING_SCRIPT))) {
                blockingIssues.add("training smoke script가 없어 DPO 학습 smoke 실행을 시작할 수 없습니다.");
            }
        } else {
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(".venv/bin/python"))) {
                blockingIssues.add("`.venv/bin/python`이 없어 DPO 학습을 실행할 수 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.TRAIN_PEFT_DPO_SCRIPT))) {
                blockingIssues.add("PEFT DPO trainer 스크립트가 없습니다.");
            }
            if (!commandRunner.pathExists(commandRunner.resolveProjectPath(ReviewTrainingSettings.DERIVE_MLX_RUNTIME_SCRIPT))) {
                blockingIssues.add("MLX runtime 파생 스크립트가 없습니다.");
            }
            List<String> missingModules = Stream.of("torch", "transformers", "peft", "trl", "datasets", "mlx_lm")
                .filter(module -> !commandRunner.hasVenvModule(module))
                .toList();
            if (!missingModules.isEmpty()) {
                blockingIssues.add(missingModuleMessage(missingModules));
            }
        }
        if (dataset.isEmpty() || dataset.get().rowCount() <= 0) {
            blockingIssues.add("최종 preference 데이터셋이 없거나 비어 있습니다.");
        }

        Optional<ReviewRepository.TrainingRunRow> latestSftRun = reviewRepository.findLatestSuccessfulTrainingRun("sft");
        if (latestSftRun.isEmpty() || json.blank(latestSftRun.get().outputAdapterPath())) {
            blockingIssues.add("먼저 성공한 SFT 학습 결과가 있어야 DPO를 실행할 수 있습니다.");
        } else {
            preflight.set("parentRunId", json.nullableTextNode(latestSftRun.get().runUid()));
            preflight.set("adapterPath", json.nullableTextNode(latestSftRun.get().outputAdapterPath()));
        }

        String sftFingerprint = json.extractText(json.object(sftPreflight.get("dataset")), "fingerprint");
        String parentSourceFingerprint = latestSftRun.map(ReviewRepository.TrainingRunRow::sourceFingerprint).orElse(null);
        String sftFingerprintRelation = null;
        if (sftFingerprint != null && parentSourceFingerprint != null) {
            sftFingerprintRelation = sftFingerprint.equals(parentSourceFingerprint) ? "match" : "mismatch";
        }
        preflight.set("sftFingerprintRelation", json.nullableTextNode(sftFingerprintRelation));

        boolean needsNewSft =
            latestSftRun.isEmpty() ||
            json.blank(latestSftRun.get().outputAdapterPath()) ||
            "mismatch".equals(sftFingerprintRelation);
        preflight.put("executionMode", needsNewSft ? "needs_new_sft" : "reuse_existing_sft");

        if ("mismatch".equals(sftFingerprintRelation)) {
            blockingIssues.add("현재 finalized SFT 데이터로 먼저 새 SFT 학습을 완료해야 DPO를 실행할 수 있습니다.");
        }

        String fingerprint = null;
        if (dataset.isPresent() && latestSftRun.isPresent() && !json.blank(latestSftRun.get().runFingerprint())) {
            fingerprint = fingerprintService.dpoFingerprint(dataset.get(), latestSftRun.get());
        }

        Optional<ReviewRepository.TrainingRunRow> duplicate = fingerprint == null
            ? Optional.empty()
            : reviewRepository.findTrainingRunByFingerprint("dpo", fingerprint);

        preflight.put("alreadyTrained", duplicate.map(row -> "succeeded".equals(row.state())).orElse(false));
        preflight.set("duplicateRunId", json.nullableTextNode(duplicate.map(ReviewRepository.TrainingRunRow::runUid).orElse(null)));
        if (duplicate.isPresent()) {
            blockingIssues.add(
                "running".equals(duplicate.get().state())
                    ? "같은 DPO 학습이 이미 실행 중입니다. runId=" + duplicate.get().runUid()
                    : "같은 DPO 데이터와 설정으로 이미 학습했습니다. runId=" + duplicate.get().runUid()
            );
        }

        preflight.set("blockingIssues", blockingIssues);
        preflight.put(
            "canStart",
            dataset.isPresent() &&
            dataset.get().rowCount() > 0 &&
            latestSftRun.isPresent() &&
            fingerprint != null &&
            blockingIssues.isEmpty()
        );
        return preflight;
    }

    private ObjectNode emptyPreflight(String kind) {
        ObjectNode preflight = objectMapper.createObjectNode();
        preflight.put("kind", kind);
        preflight.put("canStart", false);
        preflight.put("alreadyTrained", false);
        preflight.set("duplicateRunId", NullNode.instance);
        preflight.set("parentRunId", NullNode.instance);
        preflight.set("adapterPath", NullNode.instance);
        preflight.set("sftFingerprintRelation", NullNode.instance);
        preflight.set("executionMode", NullNode.instance);
        preflight.set("trainingBackend", NullNode.instance);
        preflight.set("blockingIssues", objectMapper.createArrayNode());
        preflight.set("dataset", datasetNode(Optional.empty()));
        return preflight;
    }

    private ObjectNode datasetNode(Optional<ReviewSnapshotSummary> dataset) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("exists", dataset.isPresent());
        node.set("manifestPath", json.nullableTextNode(dataset.map(ReviewSnapshotSummary::manifestPath).orElse(null)));
        node.set("datasetVersion", json.nullableTextNode(dataset.map(ReviewSnapshotSummary::datasetVersion).orElse(null)));
        node.set("fingerprint", json.nullableTextNode(dataset.map(ReviewSnapshotSummary::fingerprint).orElse(null)));
        node.set("rowCount", json.nullableNumberNode(dataset.map(summary -> Integer.valueOf(summary.rowCount())).orElse(null)));
        return node;
    }

    private String missingModuleMessage(List<String> modules) {
        return "PEFT/MLX 학습 의존성이 없습니다: " + String.join(", ", modules) +
            ". `.venv/bin/pip install -r backend/requirements-peft.txt`가 필요합니다.";
    }
}
