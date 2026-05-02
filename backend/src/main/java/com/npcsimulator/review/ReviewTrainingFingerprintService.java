package com.npcsimulator.review;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingFingerprintService {

    private final ObjectMapper objectMapper;
    private final ReviewTrainingSettings settings;

    ReviewTrainingFingerprintService(
        ObjectMapper objectMapper,
        ReviewTrainingSettings settings
    ) {
        this.objectMapper = objectMapper;
        this.settings = settings;
    }

    String sftFingerprint(ReviewSnapshotSummary dataset) {
        return fingerprintJson(sftPreflightFingerprint(dataset));
    }

    String dpoFingerprint(
        ReviewSnapshotSummary dataset,
        ReviewRepository.TrainingRunRow latestSftRun
    ) {
        return fingerprintJson(dpoPreflightFingerprint(dataset, latestSftRun));
    }

    private LinkedHashMap<String, Object> sftPreflightFingerprint(ReviewSnapshotSummary dataset) {
        LinkedHashMap<String, Object> root = new LinkedHashMap<>();
        root.put("kind", "sft");
        root.put("baseModel", settings.trainingBaseModel());
        root.put("sourceFingerprint", dataset.fingerprint());
        root.put("training", sftTrainingArgs());
        LinkedHashMap<String, Object> build = new LinkedHashMap<>();
        build.put("inputFormat", "compact");
        build.put("assistantFormat", "reply_text");
        root.put("build", build);
        return root;
    }

    private LinkedHashMap<String, Object> dpoPreflightFingerprint(
        ReviewSnapshotSummary dataset,
        ReviewRepository.TrainingRunRow latestSftRun
    ) {
        LinkedHashMap<String, Object> root = new LinkedHashMap<>();
        root.put("kind", "dpo");
        root.put("baseModel", settings.trainingBaseModel());
        root.put("sourceFingerprint", dataset.fingerprint());
        root.put("parentRunUid", latestSftRun.runUid());
        root.put("parentFingerprint", latestSftRun.runFingerprint());
        root.put("training", dpoTrainingArgs());
        return root;
    }

    private LinkedHashMap<String, Object> sftTrainingArgs() {
        LinkedHashMap<String, Object> args = new LinkedHashMap<>();
        args.put("batchSize", settings.sftBatchSize());
        args.put("iters", settings.sftIters());
        args.put("learningRate", settings.sftLearningRate());
        args.put("numLayers", settings.sftNumLayers());
        args.put("stepsPerReport", settings.sftStepsPerReport());
        args.put("stepsPerEval", settings.sftStepsPerEval());
        args.put("saveEvery", settings.sftSaveEvery());
        args.put("maxSeqLength", settings.sftMaxSeqLength());
        return args;
    }

    private LinkedHashMap<String, Object> dpoTrainingArgs() {
        LinkedHashMap<String, Object> args = new LinkedHashMap<>();
        args.put("batchSize", settings.dpoBatchSize());
        args.put("iters", settings.dpoIters());
        args.put("learningRate", settings.dpoLearningRate());
        args.put("numLayers", settings.dpoNumLayers());
        args.put("stepsPerReport", settings.dpoStepsPerReport());
        args.put("stepsPerEval", settings.dpoStepsPerEval());
        args.put("saveEvery", settings.dpoSaveEvery());
        args.put("beta", settings.dpoBeta());
        args.put("maxSeqLength", settings.dpoMaxSeqLength());
        return args;
    }

    private String fingerprintJson(LinkedHashMap<String, Object> payload) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(json.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte value : hashed) {
                builder.append(String.format("%02x", value));
            }
            return builder.toString();
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to fingerprint training spec.", error);
        }
    }
}
