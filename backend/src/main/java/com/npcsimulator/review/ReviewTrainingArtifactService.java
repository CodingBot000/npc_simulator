package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class ReviewTrainingArtifactService {

    private final ReviewRepository reviewRepository;
    private final ObjectMapper objectMapper;
    private final ReviewRuntimeCommandRunner commandRunner;

    ReviewTrainingArtifactService(
        ReviewRepository reviewRepository,
        ObjectMapper objectMapper,
        ReviewRuntimeCommandRunner commandRunner
    ) {
        this.reviewRepository = reviewRepository;
        this.objectMapper = objectMapper;
        this.commandRunner = commandRunner;
    }

    void registerFinalizeArtifacts(
        String runUid,
        String sftOutputDir,
        String preferenceOutputDir
    ) {
        registerTrainingArtifact(
            runUid,
            "finalize_sft_manifest",
            commandRunner.resolveRequiredProjectPath(sftOutputDir).resolve("manifest.json"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_sft_train",
            commandRunner.resolveRequiredProjectPath(sftOutputDir).resolve("final_sft_train.jsonl"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_sft_dev",
            commandRunner.resolveRequiredProjectPath(sftOutputDir).resolve("final_sft_dev.jsonl"),
            artifactMetadata("finalize", "sft")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_preference_manifest",
            commandRunner.resolveRequiredProjectPath(preferenceOutputDir).resolve("manifest.json"),
            artifactMetadata("finalize", "preference")
        );
        registerTrainingArtifact(
            runUid,
            "finalize_preference_pairs",
            commandRunner.resolveRequiredProjectPath(preferenceOutputDir).resolve("final_preference_pairs.jsonl"),
            artifactMetadata("finalize", "preference")
        );
    }

    void registerTrainingDatasetArtifacts(ReviewTrainingRunSpec spec) {
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_manifest",
            Path.of(spec.datasetDir()).resolve("manifest.json"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_train",
            Path.of(spec.datasetDir()).resolve("train.jsonl"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
        registerTrainingArtifact(
            spec.runUid(),
            "dataset_valid",
            Path.of(spec.datasetDir()).resolve("valid.jsonl"),
            trainingArtifactMetadata(spec, "dataset_build")
        );
    }

    ObjectNode trainingArtifactMetadata(ReviewTrainingRunSpec spec, String artifactPhase) {
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("runId", spec.runUid());
        metadata.put("kind", spec.kind());
        metadata.put("canonicalModelFamily", spec.canonicalModelFamily());
        metadata.put("artifactPhase", artifactPhase);
        metadata.put("baseModel", spec.baseModel());
        metadata.put("trainingBackend", spec.trainingBackend());
        metadata.put("sourceDatasetVersion", spec.sourceDatasetVersion());
        metadata.put("sourceFingerprint", spec.sourceFingerprint());
        if (spec.adapterPath() == null) {
            metadata.putNull("canonicalAdapterPath");
        } else {
            metadata.put("canonicalAdapterPath", spec.adapterPath());
        }
        if (spec.runtimeArtifactPath() == null) {
            metadata.putNull("runtimeArtifactPath");
        } else {
            metadata.put("runtimeArtifactPath", spec.runtimeArtifactPath());
        }
        if (spec.runtimeArtifactKind() == null) {
            metadata.putNull("runtimeArtifactKind");
        } else {
            metadata.put("runtimeArtifactKind", spec.runtimeArtifactKind());
        }
        if (spec.remoteProvider() == null) {
            metadata.putNull("remoteProvider");
        } else {
            metadata.put("remoteProvider", spec.remoteProvider());
        }
        return metadata;
    }

    ObjectNode artifactMetadata(String pipeline, String datasetKind) {
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("pipeline", pipeline);
        metadata.put("datasetKind", datasetKind);
        return metadata;
    }

    void registerTrainingArtifact(
        String runUid,
        String artifactKind,
        Path artifactPath,
        JsonNode metadataJson
    ) {
        if (artifactPath == null || !Files.exists(artifactPath)) {
            return;
        }

        Long fileSizeBytes = null;
        String sha256 = null;
        try {
            if (Files.isRegularFile(artifactPath)) {
                fileSizeBytes = Files.size(artifactPath);
                sha256 = sha256Hex(artifactPath);
            }
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to inspect artifact: " + artifactPath, error);
        }

        reviewRepository.insertTrainingRunArtifact(
            runUid,
            artifactKind,
            artifactPath.toString(),
            fileSizeBytes,
            sha256,
            metadataJson
        );
    }

    private String sha256Hex(Path path) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(Files.readAllBytes(path));
            byte[] hashed = digest.digest();
            StringBuilder builder = new StringBuilder();
            for (byte value : hashed) {
                builder.append(String.format("%02x", value));
            }
            return builder.toString();
        } catch (Exception error) {
            throw new ReviewApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to hash artifact: " + path, error);
        }
    }
}
