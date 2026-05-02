package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ReviewTrainingRunRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ReviewJdbcSupport jdbcSupport;
    private final ReviewRepositoryRowMapper rowMapper;

    ReviewTrainingRunRepository(
        JdbcTemplate jdbcTemplate,
        ReviewJdbcSupport jdbcSupport,
        ReviewRepositoryRowMapper rowMapper
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.jdbcSupport = jdbcSupport;
        this.rowMapper = rowMapper;
    }

    Optional<ReviewRepository.TrainingRunRow> findLatestFinalizeRun() {
        List<ReviewRepository.TrainingRunRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE run_kind = 'finalize'
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> rowMapper.mapTrainingRunRow(rs)
        );
        return rows.stream().findFirst();
    }

    List<ReviewRepository.TrainingRunRow> listTrainingRuns(List<String> kinds) {
        if (kinds.isEmpty()) {
            return List.of();
        }

        String placeholders = String.join(",", java.util.Collections.nCopies(kinds.size(), "?"));
        return jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE run_kind IN (""" + placeholders + """
             )
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
            """,
            (rs, rowNum) -> rowMapper.mapTrainingRunRow(rs),
            kinds.toArray()
        );
    }

    Optional<ReviewRepository.TrainingRunRow> findLatestSuccessfulTrainingRun(String runKind) {
        List<ReviewRepository.TrainingRunRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE run_kind = ?
               AND state = 'succeeded'
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> rowMapper.mapTrainingRunRow(rs),
            runKind
        );
        return rows.stream().findFirst();
    }

    Optional<ReviewRepository.TrainingRunRow> findTrainingRunByFingerprint(String runKind, String fingerprint) {
        List<ReviewRepository.TrainingRunRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE run_kind = ?
               AND run_fingerprint = ?
               AND state IN ('running', 'succeeded')
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> rowMapper.mapTrainingRunRow(rs),
            runKind,
            fingerprint
        );
        return rows.stream().findFirst();
    }

    Optional<ReviewRepository.TrainingRunRow> findTrainingRunByUid(String runUid) {
        List<ReviewRepository.TrainingRunRow> rows = jdbcTemplate.query(
            "SELECT * FROM npc_training_run WHERE run_uid = ? ORDER BY id DESC LIMIT 1",
            (rs, rowNum) -> rowMapper.mapTrainingRunRow(rs),
            runUid
        );
        return rows.stream().findFirst();
    }

    Optional<ReviewRepository.TrainingRunRow> findLatestPromotedTrainingRun(String bindingKey) {
        List<ReviewRepository.TrainingRunRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE state = 'succeeded'
               AND promoted_binding_key = ?
               AND promoted_at IS NOT NULL
             ORDER BY promoted_at DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> rowMapper.mapTrainingRunRow(rs),
            bindingKey
        );
        return rows.stream().findFirst();
    }

    ReviewRepository.FinalizeRunRecord createFinalizeRun() {
        String runUid = java.time.Instant.now().toString().replaceAll("[:.]", "-") + "_finalize";
        Timestamp now = jdbcSupport.utcNowTimestamp();
        jdbcTemplate.update(
            """
            INSERT INTO npc_training_run (
                run_uid,
                run_kind,
                state,
                current_step,
                message,
                params_json,
                metrics_json,
                requested_from,
                started_at,
                created_at,
                updated_at
            ) VALUES (?, 'finalize', 'running', 'finalize_sft', ?, CAST(? AS JSON), CAST(? AS JSON), 'review_finalize', ?, ?, ?)
            """,
            runUid,
            "SFT finalize 실행 중",
            jdbcSupport.writeJson(jdbcSupport.createObjectNode()),
            jdbcSupport.writeJson(jdbcSupport.finalizeMetricsNode(
                new ReviewRepository.FinalizeMetrics(null, null, null),
                new ReviewRepository.FinalizeOutputs(null, null)
            )),
            now,
            now,
            now
        );
        return new ReviewRepository.FinalizeRunRecord(runUid);
    }

    void updateFinalizeRun(
        String runUid,
        String state,
        String currentStep,
        String message,
        String finishedAt,
        ReviewRepository.FinalizeMetrics durations,
        ReviewRepository.FinalizeOutputs outputs
    ) {
        ReviewRepository.TrainingRunRow current = findTrainingRunByUid(runUid)
            .orElseThrow(() -> new IllegalStateException("finalize run not found: " + runUid));
        ObjectNode metrics = jdbcSupport.object(current.metricsJson());
        ObjectNode nextMetrics = jdbcSupport.finalizeMetricsNode(
            durations != null ? durations : new ReviewRepository.FinalizeMetrics(
                jdbcSupport.asLong(jdbcSupport.object(metrics.get("durations")).get("sftMs")),
                jdbcSupport.asLong(jdbcSupport.object(metrics.get("durations")).get("preferenceMs")),
                jdbcSupport.asLong(jdbcSupport.object(metrics.get("durations")).get("totalMs"))
            ),
            outputs != null ? outputs : new ReviewRepository.FinalizeOutputs(
                jdbcSupport.extractText(jdbcSupport.object(metrics.get("outputs")), "sft"),
                jdbcSupport.extractText(jdbcSupport.object(metrics.get("outputs")), "preference")
            )
        );
        Timestamp now = jdbcSupport.utcNowTimestamp();

        jdbcTemplate.update(
            """
            UPDATE npc_training_run
               SET state = ?,
                   current_step = ?,
                   message = ?,
                   metrics_json = CAST(? AS JSON),
                   finished_at = ?,
                   updated_at = ?
             WHERE run_uid = ?
            """,
            state,
            currentStep,
            message,
            jdbcSupport.writeJson(nextMetrics),
            jdbcSupport.toTimestamp(finishedAt),
            now,
            runUid
        );
    }

    void createTrainingRun(
        String runUid,
        String kind,
        String trainingBackend,
        String canonicalModelFamily,
        String state,
        String currentStep,
        String message,
        Long sourceSnapshotId,
        String sourceFingerprint,
        String sourceDatasetVersion,
        String parentRunUid,
        String baseModel,
        String datasetDir,
        String adapterPath,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        String remoteProvider,
        String remoteJobId,
        String remoteTrainingFileId,
        String remoteValidationFileId,
        String remoteModelName,
        String logPath,
        String trainingResultPath,
        String fingerprint,
        Object commands
    ) {
        Long parentRunId = parentRunUid == null ? null : findTrainingRunIdByUid(parentRunUid);
        ObjectNode params = jdbcSupport.createObjectNode();
        params.put("canonicalModelFamily", canonicalModelFamily);
        params.put("sourceDatasetVersion", sourceDatasetVersion);
        params.put("parentRunUid", parentRunUid);
        params.put("logPath", logPath);
        params.put("trainingResultPath", trainingResultPath);
        params.set("commands", jdbcSupport.valueToTree(commands));

        ObjectNode metrics = jdbcSupport.createObjectNode();
        ObjectNode durations = metrics.putObject("durations");
        durations.putNull("buildMs");
        durations.putNull("trainMs");
        durations.putNull("totalMs");
        Timestamp now = jdbcSupport.utcNowTimestamp();

        jdbcTemplate.update(
            """
            INSERT INTO npc_training_run (
                run_uid,
                run_kind,
                state,
                current_step,
                message,
                source_snapshot_id,
                parent_run_id,
                base_model,
                training_backend,
                output_adapter_path,
                output_adapter_version,
                runtime_artifact_path,
                runtime_artifact_kind,
                remote_provider,
                remote_job_id,
                remote_training_file_id,
                remote_validation_file_id,
                remote_model_name,
                dataset_work_dir,
                params_json,
                metrics_json,
                run_fingerprint,
                source_fingerprint,
                requested_from,
                started_at,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, 'review_training', ?, ?, ?)
            """,
            runUid,
            kind,
            state,
            currentStep,
            message,
            sourceSnapshotId,
            parentRunId,
            baseModel,
            trainingBackend,
            adapterPath,
            null,
            runtimeArtifactPath,
            runtimeArtifactKind,
            remoteProvider,
            remoteJobId,
            remoteTrainingFileId,
            remoteValidationFileId,
            remoteModelName,
            datasetDir,
            jdbcSupport.writeJson(params),
            jdbcSupport.writeJson(metrics),
            fingerprint,
            sourceFingerprint,
            now,
            now,
            now
        );
    }

    void appendTrainingRunEvent(
        String runUid,
        String level,
        String eventType,
        String step,
        String message,
        JsonNode payload
    ) {
        Long runId = findTrainingRunIdByUid(runUid);
        if (runId == null) {
            return;
        }

        Integer currentSeq = jdbcTemplate.queryForObject(
            "SELECT COALESCE(MAX(seq_no), 0) FROM npc_training_run_event WHERE training_run_id = ?",
            Integer.class,
            runId
        );
        int nextSeq = (currentSeq == null ? 0 : currentSeq) + 1;

        jdbcTemplate.update(
            """
            INSERT INTO npc_training_run_event (
                training_run_id,
                seq_no,
                level,
                event_type,
                step,
                message,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))
            """,
            runId,
            nextSeq,
            level,
            eventType,
            step,
            message,
            jdbcSupport.writeJson(payload == null ? NullNode.instance : payload)
        );
    }

    void updateTrainingRunState(
        String runUid,
        String state,
        String currentStep,
        String message,
        String finishedAt,
        String trainingBackend,
        String adapterPath,
        String adapterVersion,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        String remoteProvider,
        String remoteJobId,
        String remoteTrainingFileId,
        String remoteValidationFileId,
        String remoteModelName,
        ReviewRepository.TrainingDurations durations
    ) {
        ReviewRepository.TrainingRunRow current = findTrainingRunByUid(runUid)
            .orElseThrow(() -> new IllegalStateException("training run not found: " + runUid));

        ObjectNode metrics = jdbcSupport.object(current.metricsJson());
        ObjectNode nextMetrics = jdbcSupport.createObjectNode();
        ObjectNode durationsNode = nextMetrics.putObject("durations");
        jdbcSupport.setNullableNumber(
            durationsNode,
            "buildMs",
            durations != null ? durations.buildMs() : jdbcSupport.asLong(jdbcSupport.object(metrics.get("durations")).get("buildMs"))
        );
        jdbcSupport.setNullableNumber(
            durationsNode,
            "trainMs",
            durations != null ? durations.trainMs() : jdbcSupport.asLong(jdbcSupport.object(metrics.get("durations")).get("trainMs"))
        );
        jdbcSupport.setNullableNumber(
            durationsNode,
            "totalMs",
            durations != null ? durations.totalMs() : jdbcSupport.asLong(jdbcSupport.object(metrics.get("durations")).get("totalMs"))
        );
        Timestamp now = jdbcSupport.utcNowTimestamp();

        jdbcTemplate.update(
            """
            UPDATE npc_training_run
               SET state = ?,
                   current_step = ?,
                   message = ?,
                   training_backend = COALESCE(?, training_backend),
                   output_adapter_path = COALESCE(?, output_adapter_path),
                   output_adapter_version = COALESCE(?, output_adapter_version),
                   runtime_artifact_path = COALESCE(?, runtime_artifact_path),
                   runtime_artifact_kind = COALESCE(?, runtime_artifact_kind),
                   remote_provider = COALESCE(?, remote_provider),
                   remote_job_id = COALESCE(?, remote_job_id),
                   remote_training_file_id = COALESCE(?, remote_training_file_id),
                   remote_validation_file_id = COALESCE(?, remote_validation_file_id),
                   remote_model_name = COALESCE(?, remote_model_name),
                   metrics_json = CAST(? AS JSON),
                   finished_at = ?,
                   updated_at = ?
             WHERE run_uid = ?
            """,
            state,
            currentStep,
            message,
            trainingBackend,
            adapterPath,
            adapterVersion,
            runtimeArtifactPath,
            runtimeArtifactKind,
            remoteProvider,
            remoteJobId,
            remoteTrainingFileId,
            remoteValidationFileId,
            remoteModelName,
            jdbcSupport.writeJson(nextMetrics),
            jdbcSupport.toTimestamp(finishedAt == null ? current.finishedAt() : finishedAt),
            now,
            runUid
        );
    }

    void updateTrainingRunEvaluation(
        String runUid,
        String evalState,
        String evalMessage,
        String evalBindingKey,
        String evalBaselineLabel,
        String evalSummaryPath,
        JsonNode evalSummaryJson,
        String evalStartedAt,
        String evalFinishedAt
    ) {
        ReviewRepository.TrainingRunRow current = findTrainingRunByUid(runUid)
            .orElseThrow(() -> new IllegalStateException("training run not found: " + runUid));
        Timestamp now = jdbcSupport.utcNowTimestamp();

        jdbcTemplate.update(
            """
            UPDATE npc_training_run
               SET eval_state = ?,
                   eval_message = ?,
                   eval_binding_key = ?,
                   eval_baseline_label = ?,
                   eval_summary_path = ?,
                   eval_summary_json = CAST(? AS JSON),
                   eval_started_at = ?,
                   eval_finished_at = ?,
                   updated_at = ?
             WHERE run_uid = ?
            """,
            evalState,
            evalMessage,
            evalBindingKey,
            evalBaselineLabel,
            evalSummaryPath,
            jdbcSupport.writeJson(evalSummaryJson == null ? current.evalSummaryJson() : evalSummaryJson),
            jdbcSupport.toTimestamp(evalStartedAt == null ? current.evalStartedAt() : evalStartedAt),
            jdbcSupport.toTimestamp(evalFinishedAt == null ? current.evalFinishedAt() : evalFinishedAt),
            now,
            runUid
        );
    }

    void updateTrainingRunReviewDecision(
        String runUid,
        String reviewDecision,
        String reviewNotes,
        String reviewedBy,
        String reviewedAt
    ) {
        Timestamp now = jdbcSupport.utcNowTimestamp();
        jdbcTemplate.update(
            """
            UPDATE npc_training_run
               SET review_decision = ?,
                   review_notes = ?,
                   reviewed_by = ?,
                   reviewed_at = ?,
                   updated_at = ?
             WHERE run_uid = ?
            """,
            reviewDecision,
            reviewNotes,
            reviewedBy,
            jdbcSupport.toTimestamp(reviewedAt),
            now,
            runUid
        );
    }

    void markTrainingRunPromoted(String runUid, String bindingKey, String promotedAt) {
        Timestamp now = jdbcSupport.utcNowTimestamp();
        jdbcTemplate.update(
            """
            UPDATE npc_training_run
               SET promoted_binding_key = ?,
                   promoted_at = ?,
                   updated_at = ?
             WHERE run_uid = ?
            """,
            bindingKey,
            jdbcSupport.toTimestamp(promotedAt),
            now,
            runUid
        );
    }

    void insertTrainingRunArtifact(
        String runUid,
        String artifactKind,
        String filePath,
        Long fileSizeBytes,
        String sha256,
        JsonNode metadataJson
    ) {
        Long runId = findTrainingRunIdByUid(runUid);
        if (runId == null) {
            return;
        }

        jdbcTemplate.update(
            """
            INSERT INTO npc_training_run_artifact (
                training_run_id,
                artifact_kind,
                file_path,
                file_size_bytes,
                sha256,
                metadata_json
            ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))
            """,
            runId,
            artifactKind,
            filePath,
            fileSizeBytes,
            sha256,
            jdbcSupport.writeJson(metadataJson == null ? NullNode.instance : metadataJson)
        );
    }

    private Long findTrainingRunIdByUid(String runUid) {
        List<Long> rows = jdbcTemplate.query(
            "SELECT id FROM npc_training_run WHERE run_uid = ? ORDER BY id DESC LIMIT 1",
            (rs, rowNum) -> rs.getLong("id"),
            runUid
        );
        return rows.isEmpty() ? null : rows.get(0);
    }
}
