package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ReviewRepository {

    private static final String LATEST_REVIEW_TASKS_FROM =
        """
        FROM npc_review_task t
        JOIN (
            SELECT review_uid, review_kind, MAX(id) AS latest_id
              FROM npc_review_task
             GROUP BY review_uid, review_kind
        ) latest
          ON latest.latest_id = t.id
        """;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ReviewRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public List<ReviewTaskRow> findReviewTasks() {
        return jdbcTemplate.query(
            "SELECT t.* " + LATEST_REVIEW_TASKS_FROM + " ORDER BY t.created_at ASC, t.id ASC",
            (rs, rowNum) -> mapReviewTaskRow(rs)
        );
    }

    public Optional<ReviewTaskRow> findReviewTask(String reviewUid, String reviewKind) {
        List<ReviewTaskRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_review_task
             WHERE review_uid = ?
               AND review_kind = ?
             ORDER BY id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> mapReviewTaskRow(rs),
            reviewUid,
            reviewKind
        );
        return rows.stream().findFirst();
    }

    public List<CandidateRow> findCandidates() {
        return jdbcTemplate.query(
            "SELECT * FROM npc_sft_candidate",
            (rs, rowNum) -> mapCandidateRow(rs)
        );
    }

    public Optional<CandidateRow> findCandidate(long id) {
        List<CandidateRow> rows = jdbcTemplate.query(
            "SELECT * FROM npc_sft_candidate WHERE id = ? ORDER BY id DESC LIMIT 1",
            (rs, rowNum) -> mapCandidateRow(rs),
            id
        );
        return rows.stream().findFirst();
    }

    public List<PairRow> findPairs() {
        return jdbcTemplate.query(
            "SELECT * FROM npc_preference_pair",
            (rs, rowNum) -> mapPairRow(rs)
        );
    }

    public Optional<PairRow> findPair(long id) {
        List<PairRow> rows = jdbcTemplate.query(
            "SELECT * FROM npc_preference_pair WHERE id = ? ORDER BY id DESC LIMIT 1",
            (rs, rowNum) -> mapPairRow(rs),
            id
        );
        return rows.stream().findFirst();
    }

    public PendingCounts getPendingReviewCounts() {
        List<PendingCountRow> rows = jdbcTemplate.query(
            """
            SELECT latest_tasks.review_kind, COUNT(*) AS pending_count
              FROM (
                SELECT t.review_kind, t.current_decision
                """ + LATEST_REVIEW_TASKS_FROM + """
              ) latest_tasks
             WHERE latest_tasks.current_decision IS NULL
             GROUP BY latest_tasks.review_kind
            """,
            (rs, rowNum) -> new PendingCountRow(
                rs.getString("review_kind"),
                rs.getLong("pending_count")
            )
        );

        int sft = 0;
        int pair = 0;
        for (PendingCountRow row : rows) {
            if ("sft".equals(row.reviewKind())) {
                sft = (int) row.pendingCount();
            } else if ("pair".equals(row.reviewKind())) {
                pair = (int) row.pendingCount();
            }
        }

        return new PendingCounts(sft, pair, sft + pair);
    }

    public String getLatestReviewUpdatedAt() {
        List<String> rows = jdbcTemplate.query(
            """
            SELECT MAX(latest_tasks.current_reviewed_at) AS updated_at
              FROM (
                SELECT t.current_reviewed_at
                """ + LATEST_REVIEW_TASKS_FROM + """
              ) latest_tasks
            """,
            (rs, rowNum) -> toIsoString(rs.getTimestamp("updated_at"))
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    public Optional<SnapshotSummaryRow> findActiveSnapshot(String datasetKind) {
        List<SnapshotSummaryRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_dataset_snapshot
             WHERE dataset_kind = ?
               AND is_active = TRUE
             ORDER BY CASE WHEN generated_at IS NULL THEN 1 ELSE 0 END, generated_at DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> mapSnapshotSummaryRow(rs),
            datasetKind
        );
        return rows.stream().findFirst();
    }

    public int countSnapshotItems(long snapshotId) {
        List<Integer> counts = jdbcTemplate.query(
            "SELECT COUNT(*) AS count FROM npc_dataset_snapshot_item WHERE snapshot_id = ?",
            (rs, rowNum) -> rs.getInt("count"),
            snapshotId
        );
        return counts.isEmpty() ? 0 : counts.get(0);
    }

    public Optional<TrainingRunRow> findLatestFinalizeRun() {
        List<TrainingRunRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE run_kind = 'finalize'
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> mapTrainingRunRow(rs)
        );
        return rows.stream().findFirst();
    }

    public List<TrainingRunRow> listTrainingRuns(List<String> kinds) {
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
            (rs, rowNum) -> mapTrainingRunRow(rs),
            kinds.toArray()
        );
    }

    public Optional<TrainingRunRow> findLatestSuccessfulTrainingRun(String runKind) {
        List<TrainingRunRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE run_kind = ?
               AND state = 'succeeded'
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> mapTrainingRunRow(rs),
            runKind
        );
        return rows.stream().findFirst();
    }

    public Optional<TrainingRunRow> findTrainingRunByFingerprint(String runKind, String fingerprint) {
        List<TrainingRunRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE run_kind = ?
               AND run_fingerprint = ?
               AND state IN ('running', 'succeeded')
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> mapTrainingRunRow(rs),
            runKind,
            fingerprint
        );
        return rows.stream().findFirst();
    }

    public Optional<TrainingRunRow> findTrainingRunByUid(String runUid) {
        List<TrainingRunRow> rows = jdbcTemplate.query(
            "SELECT * FROM npc_training_run WHERE run_uid = ? ORDER BY id DESC LIMIT 1",
            (rs, rowNum) -> mapTrainingRunRow(rs),
            runUid
        );
        return rows.stream().findFirst();
    }

    public Optional<TrainingRunRow> findLatestPromotedTrainingRun(String bindingKey) {
        List<TrainingRunRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_training_run
             WHERE state = 'succeeded'
               AND promoted_binding_key = ?
               AND promoted_at IS NOT NULL
             ORDER BY promoted_at DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> mapTrainingRunRow(rs),
            bindingKey
        );
        return rows.stream().findFirst();
    }

    public FinalizeRunRecord createFinalizeRun() {
        String runUid = java.time.Instant.now().toString().replaceAll("[:.]", "-") + "_finalize";
        Timestamp now = utcNowTimestamp();
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
            writeJson(objectMapper.createObjectNode()),
            writeJson(finalizeMetricsNode(
                new FinalizeMetrics(null, null, null),
                new FinalizeOutputs(null, null)
            )),
            now,
            now,
            now
        );
        return new FinalizeRunRecord(runUid);
    }

    public void updateFinalizeRun(
        String runUid,
        String state,
        String currentStep,
        String message,
        String finishedAt,
        FinalizeMetrics durations,
        FinalizeOutputs outputs
    ) {
        TrainingRunRow current = findTrainingRunByUid(runUid)
            .orElseThrow(() -> new IllegalStateException("finalize run not found: " + runUid));
        ObjectNode metrics = object(current.metricsJson());
        ObjectNode nextMetrics = finalizeMetricsNode(
            durations != null ? durations : new FinalizeMetrics(
                asLong(object(metrics.get("durations")).get("sftMs")),
                asLong(object(metrics.get("durations")).get("preferenceMs")),
                asLong(object(metrics.get("durations")).get("totalMs"))
            ),
            outputs != null ? outputs : new FinalizeOutputs(
                extractText(object(metrics.get("outputs")), "sft"),
                extractText(object(metrics.get("outputs")), "preference")
            )
        );
        Timestamp now = utcNowTimestamp();

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
            writeJson(nextMetrics),
            toTimestamp(finishedAt),
            now,
            runUid
        );
    }

    public void createTrainingRun(
        String runUid,
        String kind,
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
        String logPath,
        String fingerprint,
        Object commands
    ) {
        Long parentRunId = parentRunUid == null ? null : findTrainingRunIdByUid(parentRunUid);
        ObjectNode params = objectMapper.createObjectNode();
        params.put("sourceDatasetVersion", sourceDatasetVersion);
        params.put("parentRunUid", parentRunUid);
        params.put("logPath", logPath);
        params.set("commands", objectMapper.valueToTree(commands));

        ObjectNode metrics = objectMapper.createObjectNode();
        ObjectNode durations = metrics.putObject("durations");
        durations.putNull("buildMs");
        durations.putNull("trainMs");
        durations.putNull("totalMs");
        Timestamp now = utcNowTimestamp();

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
                output_adapter_path,
                runtime_artifact_path,
                runtime_artifact_kind,
                dataset_work_dir,
                params_json,
                metrics_json,
                run_fingerprint,
                source_fingerprint,
                requested_from,
                started_at,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, 'review_training', ?, ?, ?)
            """,
            runUid,
            kind,
            state,
            currentStep,
            message,
            sourceSnapshotId,
            parentRunId,
            baseModel,
            adapterPath,
            runtimeArtifactPath,
            runtimeArtifactKind,
            datasetDir,
            writeJson(params),
            writeJson(metrics),
            fingerprint,
            sourceFingerprint,
            now,
            now,
            now
        );
    }

    public void appendTrainingRunEvent(
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
            writeJson(payload == null ? NullNode.instance : payload)
        );
    }

    public void updateTrainingRunState(
        String runUid,
        String state,
        String currentStep,
        String message,
        String finishedAt,
        String adapterPath,
        String adapterVersion,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        TrainingDurations durations
    ) {
        TrainingRunRow current = findTrainingRunByUid(runUid)
            .orElseThrow(() -> new IllegalStateException("training run not found: " + runUid));

        ObjectNode metrics = object(current.metricsJson());
        ObjectNode nextMetrics = objectMapper.createObjectNode();
        ObjectNode durationsNode = nextMetrics.putObject("durations");
        setNullableNumber(
            durationsNode,
            "buildMs",
            durations != null ? durations.buildMs() : asLong(object(metrics.get("durations")).get("buildMs"))
        );
        setNullableNumber(
            durationsNode,
            "trainMs",
            durations != null ? durations.trainMs() : asLong(object(metrics.get("durations")).get("trainMs"))
        );
        setNullableNumber(
            durationsNode,
            "totalMs",
            durations != null ? durations.totalMs() : asLong(object(metrics.get("durations")).get("totalMs"))
        );
        Timestamp now = utcNowTimestamp();

        jdbcTemplate.update(
            """
            UPDATE npc_training_run
               SET state = ?,
                   current_step = ?,
                   message = ?,
                   output_adapter_path = COALESCE(?, output_adapter_path),
                   output_adapter_version = COALESCE(?, output_adapter_version),
                   runtime_artifact_path = COALESCE(?, runtime_artifact_path),
                   runtime_artifact_kind = COALESCE(?, runtime_artifact_kind),
                   metrics_json = CAST(? AS JSON),
                   finished_at = ?,
                   updated_at = ?
             WHERE run_uid = ?
            """,
            state,
            currentStep,
            message,
            adapterPath,
            adapterVersion,
            runtimeArtifactPath,
            runtimeArtifactKind,
            writeJson(nextMetrics),
            toTimestamp(finishedAt == null ? current.finishedAt() : finishedAt),
            now,
            runUid
        );
    }

    public void updateTrainingRunEvaluation(
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
        TrainingRunRow current = findTrainingRunByUid(runUid)
            .orElseThrow(() -> new IllegalStateException("training run not found: " + runUid));
        Timestamp now = utcNowTimestamp();

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
            writeJson(evalSummaryJson == null ? current.evalSummaryJson() : evalSummaryJson),
            toTimestamp(evalStartedAt == null ? current.evalStartedAt() : evalStartedAt),
            toTimestamp(evalFinishedAt == null ? current.evalFinishedAt() : evalFinishedAt),
            now,
            runUid
        );
    }

    public void updateTrainingRunReviewDecision(
        String runUid,
        String reviewDecision,
        String reviewNotes,
        String reviewedBy,
        String reviewedAt
    ) {
        Timestamp now = utcNowTimestamp();
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
            toTimestamp(reviewedAt),
            now,
            runUid
        );
    }

    public void markTrainingRunPromoted(String runUid, String bindingKey, String promotedAt) {
        Timestamp now = utcNowTimestamp();
        jdbcTemplate.update(
            """
            UPDATE npc_training_run
               SET promoted_binding_key = ?,
                   promoted_at = ?,
                   updated_at = ?
             WHERE run_uid = ?
            """,
            bindingKey,
            toTimestamp(promotedAt),
            now,
            runUid
        );
    }

    public void insertTrainingRunArtifact(
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
            writeJson(metadataJson == null ? NullNode.instance : metadataJson)
        );
    }

    public void updateReviewTaskDecision(
        long taskId,
        String decision,
        String reviewer,
        String notes,
        String reviewedAt,
        String nextStatus
    ) {
        Timestamp now = utcNowTimestamp();
        jdbcTemplate.update(
            """
            UPDATE npc_review_task
               SET current_decision = ?,
                   current_reviewer = ?,
                   current_notes = ?,
                   current_reviewed_at = ?,
                   status = ?,
                   updated_at = ?
             WHERE id = ?
            """,
            decision,
            reviewer,
            notes,
            toTimestamp(reviewedAt),
            nextStatus,
            now,
            taskId
        );
    }

    public void insertReviewDecisionEvent(
        long taskId,
        String decision,
        String nextStatus,
        String reviewer,
        String notes,
        JsonNode checklist,
        String decidedAt
    ) {
        jdbcTemplate.update(
            """
            INSERT INTO npc_review_decision_event (
                review_task_id,
                decision,
                status_after,
                reviewer,
                notes,
                checklist_json,
                decided_at
            ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)
            """,
            taskId,
            decision,
            nextStatus,
            reviewer,
            notes,
            writeJson(checklist),
            toTimestamp(decidedAt)
        );
    }

    private ReviewTaskRow mapReviewTaskRow(ResultSet rs) throws SQLException {
        return new ReviewTaskRow(
            rs.getLong("id"),
            rs.getString("review_uid"),
            rs.getString("review_kind"),
            getNullableLong(rs, "sft_candidate_id"),
            getNullableLong(rs, "preference_pair_id"),
            rs.getString("bucket"),
            rs.getString("priority"),
            rs.getString("status"),
            getNullableBoolean(rs, "review_required"),
            rs.getString("queue_reason"),
            readJson(rs, "selection_reasons_json"),
            readJson(rs, "selection_metrics_json"),
            readJson(rs, "llm_first_pass_json"),
            readJson(rs, "checklist_json"),
            rs.getString("current_decision"),
            rs.getString("current_reviewer"),
            toIsoString(rs.getTimestamp("current_reviewed_at")),
            rs.getString("current_notes"),
            toIsoString(rs.getTimestamp("created_at")),
            toIsoString(rs.getTimestamp("updated_at"))
        );
    }

    private CandidateRow mapCandidateRow(ResultSet rs) throws SQLException {
        return new CandidateRow(
            rs.getLong("id"),
            rs.getString("row_key"),
            rs.getString("canonical_row_key"),
            readJson(rs, "prompt_bundle_json"),
            readJson(rs, "assistant_output_json"),
            readJson(rs, "metadata_json"),
            readJson(rs, "judge_result_json"),
            readJson(rs, "filter_result_json"),
            getNullableBigDecimal(rs, "weighted_judge_score"),
            rs.getString("strategy_label"),
            rs.getString("scenario_id"),
            rs.getString("npc_id"),
            rs.getString("target_npc_id"),
            rs.getString("input_mode"),
            rs.getString("source_export_path"),
            rs.getString("source_label")
        );
    }

    private PairRow mapPairRow(ResultSet rs) throws SQLException {
        return new PairRow(
            rs.getLong("id"),
            rs.getString("pair_key"),
            rs.getString("grouping_strategy"),
            rs.getString("grouping_key"),
            readJson(rs, "prompt_bundle_json"),
            getNullableLong(rs, "chosen_candidate_id"),
            getNullableLong(rs, "rejected_candidate_id"),
            readJson(rs, "pair_reason_json"),
            getNullableBigDecimal(rs, "weighted_gap"),
            getNullableBigDecimal(rs, "pair_confidence"),
            getNullableBigDecimal(rs, "preference_strength"),
            readJson(rs, "judge_result_json"),
            rs.getString("pair_decision")
        );
    }

    private SnapshotSummaryRow mapSnapshotSummaryRow(ResultSet rs) throws SQLException {
        return new SnapshotSummaryRow(
            rs.getLong("id"),
            rs.getString("dataset_kind"),
            rs.getString("dataset_version"),
            rs.getString("source_fingerprint"),
            rs.getString("output_uri"),
            readJson(rs, "manifest_json"),
            toIsoString(rs.getTimestamp("generated_at"))
        );
    }

    private TrainingRunRow mapTrainingRunRow(ResultSet rs) throws SQLException {
        return new TrainingRunRow(
            rs.getLong("id"),
            rs.getString("run_uid"),
            rs.getString("run_kind"),
            rs.getString("state"),
            rs.getString("current_step"),
            rs.getString("message"),
            getNullableLong(rs, "source_snapshot_id"),
            rs.getString("base_model"),
            rs.getString("output_adapter_path"),
            rs.getString("output_adapter_version"),
            rs.getString("runtime_artifact_path"),
            rs.getString("runtime_artifact_kind"),
            rs.getString("dataset_work_dir"),
            rs.getString("run_fingerprint"),
            rs.getString("source_fingerprint"),
            readJson(rs, "params_json"),
            readJson(rs, "metrics_json"),
            rs.getString("eval_state"),
            rs.getString("eval_message"),
            rs.getString("eval_binding_key"),
            rs.getString("eval_baseline_label"),
            rs.getString("eval_summary_path"),
            readJson(rs, "eval_summary_json"),
            toIsoString(rs.getTimestamp("eval_started_at")),
            toIsoString(rs.getTimestamp("eval_finished_at")),
            rs.getString("review_decision"),
            rs.getString("review_notes"),
            rs.getString("reviewed_by"),
            toIsoString(rs.getTimestamp("reviewed_at")),
            rs.getString("promoted_binding_key"),
            toIsoString(rs.getTimestamp("promoted_at")),
            toIsoString(rs.getTimestamp("started_at")),
            toIsoString(rs.getTimestamp("finished_at")),
            toIsoString(rs.getTimestamp("updated_at")),
            toIsoString(rs.getTimestamp("created_at"))
        );
    }

    private JsonNode readJson(ResultSet rs, String columnName) throws SQLException {
        String raw = rs.getString(columnName);
        if (raw == null || raw.isBlank()) {
            return NullNode.instance;
        }

        try {
            return objectMapper.readTree(raw);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to parse review JSON column: " + columnName, error);
        }
    }

    private String writeJson(JsonNode value) {
        try {
            return value == null || value.isNull() ? null : objectMapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to serialize review JSON column.", error);
        }
    }

    private Long getNullableLong(ResultSet rs, String columnName) throws SQLException {
        Object value = rs.getObject(columnName);
        return value instanceof Number number ? number.longValue() : null;
    }

    private Boolean getNullableBoolean(ResultSet rs, String columnName) throws SQLException {
        Object value = rs.getObject(columnName);
        return value instanceof Boolean bool ? bool : null;
    }

    private BigDecimal getNullableBigDecimal(ResultSet rs, String columnName) throws SQLException {
        return rs.getBigDecimal(columnName);
    }

    private String toIsoString(Timestamp value) {
        return value == null ? null : value.toLocalDateTime().toInstant(ZoneOffset.UTC).toString();
    }

    private Timestamp toTimestamp(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return Timestamp.valueOf(LocalDateTime.ofInstant(Instant.parse(value), ZoneOffset.UTC));
    }

    private Timestamp utcNowTimestamp() {
        return Timestamp.valueOf(LocalDateTime.now(ZoneOffset.UTC));
    }

    private Long findTrainingRunIdByUid(String runUid) {
        List<Long> rows = jdbcTemplate.query(
            "SELECT id FROM npc_training_run WHERE run_uid = ? ORDER BY id DESC LIMIT 1",
            (rs, rowNum) -> rs.getLong("id"),
            runUid
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    private ObjectNode finalizeMetricsNode(FinalizeMetrics durations, FinalizeOutputs outputs) {
        ObjectNode metrics = objectMapper.createObjectNode();
        ObjectNode durationsNode = metrics.putObject("durations");
        setNullableNumber(durationsNode, "sftMs", durations.sftMs());
        setNullableNumber(durationsNode, "preferenceMs", durations.preferenceMs());
        setNullableNumber(durationsNode, "totalMs", durations.totalMs());
        ObjectNode outputsNode = metrics.putObject("outputs");
        setNullableText(outputsNode, "sft", outputs.sft());
        setNullableText(outputsNode, "preference", outputs.preference());
        return metrics;
    }

    private void setNullableNumber(ObjectNode node, String fieldName, Long value) {
        if (value == null) {
            node.putNull(fieldName);
        } else {
            node.put(fieldName, value);
        }
    }

    private void setNullableText(ObjectNode node, String fieldName, String value) {
        if (value == null || value.isBlank()) {
            node.putNull(fieldName);
        } else {
            node.put(fieldName, value);
        }
    }

    private Long asLong(JsonNode value) {
        if (value == null || value.isNull()) {
            return null;
        }
        if (value.isNumber()) {
            return value.longValue();
        }
        if (value.isTextual()) {
            try {
                return Long.parseLong(value.asText());
            } catch (NumberFormatException error) {
                return null;
            }
        }
        return null;
    }

    private String extractText(ObjectNode node, String fieldName) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? null : text;
    }

    private ObjectNode object(JsonNode value) {
        if (value instanceof ObjectNode objectNode) {
            return objectNode;
        }
        if (value != null && value.isTextual()) {
            try {
                JsonNode parsed = objectMapper.readTree(value.asText());
                if (parsed instanceof ObjectNode objectNode) {
                    return objectNode;
                }
            } catch (Exception ignored) {
                // Ignore legacy stringified JSON and return an empty object.
            }
        }
        return objectMapper.createObjectNode();
    }

    private record PendingCountRow(String reviewKind, long pendingCount) {}

    public record FinalizeRunRecord(String runUid) {}

    public record FinalizeMetrics(Long sftMs, Long preferenceMs, Long totalMs) {}

    public record FinalizeOutputs(String sft, String preference) {}

    public record TrainingDurations(Long buildMs, Long trainMs, Long totalMs) {}

    public record PendingCounts(int sft, int pair, int total) {}

    public record ReviewTaskRow(
        long id,
        String reviewUid,
        String reviewKind,
        Long sftCandidateId,
        Long preferencePairId,
        String bucket,
        String priority,
        String status,
        Boolean reviewRequired,
        String queueReason,
        JsonNode selectionReasonsJson,
        JsonNode selectionMetricsJson,
        JsonNode llmFirstPassJson,
        JsonNode checklistJson,
        String currentDecision,
        String currentReviewer,
        String currentReviewedAt,
        String currentNotes,
        String createdAt,
        String updatedAt
    ) {}

    public record CandidateRow(
        long id,
        String rowKey,
        String canonicalRowKey,
        JsonNode promptBundleJson,
        JsonNode assistantOutputJson,
        JsonNode metadataJson,
        JsonNode judgeResultJson,
        JsonNode filterResultJson,
        BigDecimal weightedJudgeScore,
        String strategyLabel,
        String scenarioId,
        String npcId,
        String targetNpcId,
        String inputMode,
        String sourceExportPath,
        String sourceLabel
    ) {}

    public record PairRow(
        long id,
        String pairKey,
        String groupingStrategy,
        String groupingKey,
        JsonNode promptBundleJson,
        Long chosenCandidateId,
        Long rejectedCandidateId,
        JsonNode pairReasonJson,
        BigDecimal weightedGap,
        BigDecimal pairConfidence,
        BigDecimal preferenceStrength,
        JsonNode judgeResultJson,
        String pairDecision
    ) {}

    public record SnapshotSummaryRow(
        long id,
        String datasetKind,
        String datasetVersion,
        String sourceFingerprint,
        String outputUri,
        JsonNode manifestJson,
        String generatedAt
    ) {}

    public record TrainingRunRow(
        long id,
        String runUid,
        String runKind,
        String state,
        String currentStep,
        String message,
        Long sourceSnapshotId,
        String baseModel,
        String outputAdapterPath,
        String outputAdapterVersion,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        String datasetWorkDir,
        String runFingerprint,
        String sourceFingerprint,
        JsonNode paramsJson,
        JsonNode metricsJson,
        String evalState,
        String evalMessage,
        String evalBindingKey,
        String evalBaselineLabel,
        String evalSummaryPath,
        JsonNode evalSummaryJson,
        String evalStartedAt,
        String evalFinishedAt,
        String reviewDecision,
        String reviewNotes,
        String reviewedBy,
        String reviewedAt,
        String promotedBindingKey,
        String promotedAt,
        String startedAt,
        String finishedAt,
        String updatedAt,
        String createdAt
    ) {}
}
