package com.npcsimulator.api.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.npcsimulator.review.ReviewRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest(properties = {
    "LOCAL_TRAINING_EXECUTION_MODE=smoke",
    "LOCAL_TRAINING_EVAL_MODE=smoke"
})
class ReviewTrainingSmokeIntegrationTests {

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ReviewRepository reviewRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        this.mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
        jdbcTemplate.update("DELETE FROM npc_training_run_artifact");
        jdbcTemplate.update("DELETE FROM npc_training_run_log_chunk");
        jdbcTemplate.update("DELETE FROM npc_training_run_event");
        jdbcTemplate.update("DELETE FROM npc_training_run");
        jdbcTemplate.update("DELETE FROM npc_dataset_snapshot_item");
        jdbcTemplate.update("DELETE FROM npc_dataset_snapshot");
        jdbcTemplate.update("DELETE FROM npc_review_task");
    }

    @Test
    void trainingEndpointCompletesSmokeRunAndRegistersArtifacts() throws Exception {
        long snapshotId = seedReviewedSnapshot();

        MvcResult launchResult = mockMvc
            .perform(
                post("/api/review/training")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "kind": "sft"
                        }
                        """
                    )
            )
            .andExpect(status().isOk())
            .andReturn();

        JsonNode launchPayload = objectMapper.readTree(launchResult.getResponse().getContentAsString());
        String runId = launchPayload.path("activeRun").path("runId").asText();
        if (runId == null || runId.isBlank()) {
            runId = launchPayload.path("latestRun").path("runId").asText();
        }
        assertThat(runId).isNotBlank();

        JsonNode finalStatus = waitForRunCompletion(runId);
        assertThat(finalStatus.path("latestRun").path("state").asText()).isEqualTo("succeeded");

        TrainingRunRow row = jdbcTemplate.queryForObject(
            """
            SELECT output_adapter_path,
                   output_adapter_version,
                   runtime_artifact_path,
                   runtime_artifact_kind,
                   dataset_work_dir
              FROM npc_training_run
             WHERE run_uid = ?
            """,
            (rs, rowNum) -> new TrainingRunRow(
                rs.getString("output_adapter_path"),
                rs.getString("output_adapter_version"),
                rs.getString("runtime_artifact_path"),
                rs.getString("runtime_artifact_kind"),
                rs.getString("dataset_work_dir")
            ),
            runId
        );

        assertThat(row).isNotNull();
        assertThat(row.adapterVersion()).isEqualTo(runId);
        assertThat(Files.exists(Path.of(row.datasetDir(), "manifest.json"))).isTrue();
        assertThat(row.runtimeArtifactKind()).isEqualTo("mlx_fused_model");
        assertThat(Files.exists(Path.of(row.adapterPath(), "adapter_config.json"))).isTrue();
        assertThat(Files.exists(Path.of(row.adapterPath(), "adapter_model.safetensors"))).isTrue();
        assertThat(Files.exists(Path.of(row.runtimeArtifactPath(), "config.json"))).isTrue();
        assertThat(Files.exists(Path.of(row.adapterPath()).getParent().resolve("training-result.json"))).isTrue();

        Integer artifactCount = jdbcTemplate.queryForObject(
            """
            SELECT COUNT(*)
              FROM npc_training_run_artifact a
              JOIN npc_training_run r
                ON r.id = a.training_run_id
             WHERE r.run_uid = ?
            """,
            Integer.class,
            runId
        );
        assertThat(artifactCount).isNotNull();
        assertThat(artifactCount).isGreaterThanOrEqualTo(4);

        Integer snapshotItemCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM npc_dataset_snapshot_item WHERE snapshot_id = ?",
            Integer.class,
            snapshotId
        );
        assertThat(snapshotItemCount).isEqualTo(1);
    }

    @Test
    void successfulTrainingRunCanBeEvaluatedAcceptedAndPromoted() throws Exception {
        seedReviewedSnapshot();

        MvcResult launchResult = mockMvc
            .perform(
                post("/api/review/training")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "kind": "sft"
                        }
                        """
                    )
            )
            .andExpect(status().isOk())
            .andReturn();

        JsonNode launchPayload = objectMapper.readTree(launchResult.getResponse().getContentAsString());
        String runId = launchPayload.path("activeRun").path("runId").asText();
        if (runId == null || runId.isBlank()) {
            runId = launchPayload.path("latestRun").path("runId").asText();
        }

        JsonNode completedStatus = waitForRunCompletion(runId);
        assertThat(completedStatus.path("latestRun").path("state").asText()).isEqualTo("succeeded");

        MvcResult evalResult = mockMvc
            .perform(
                post("/api/review/training/evaluate")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "runId": "%s",
                          "bindingKey": "default"
                        }
                        """.formatted(runId)
                    )
            )
            .andExpect(status().isOk())
            .andReturn();

        JsonNode evalPayload = objectMapper.readTree(evalResult.getResponse().getContentAsString());
        assertThat(evalPayload.path("latestRun").path("evaluation").path("state").asText()).isEqualTo("succeeded");
        assertThat(evalPayload.path("latestRun").path("evaluation").path("recommendation").asText()).isEqualTo("promote");
        assertThat(evalPayload.path("latestRun").path("evaluation").path("summaryPath").asText()).isNotBlank();

        mockMvc
            .perform(
                post("/api/review/training/decision")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "runId": "%s",
                          "decision": "accepted",
                          "reviewer": "smoke-tester",
                          "notes": "looks good"
                        }
                        """.formatted(runId)
                    )
            )
            .andExpect(status().isOk());

        MvcResult promoteResult = mockMvc
            .perform(
                post("/api/review/training/promote")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "runId": "%s",
                          "bindingKey": "default"
                        }
                        """.formatted(runId)
                    )
            )
            .andExpect(status().isOk())
            .andReturn();

        JsonNode promotePayload = objectMapper.readTree(promoteResult.getResponse().getContentAsString());
        assertThat(promotePayload.path("latestRun").path("decision").path("state").asText()).isEqualTo("accepted");
        assertThat(promotePayload.path("latestRun").path("promotion").path("isPromoted").asBoolean()).isTrue();
        assertThat(promotePayload.path("latestRun").path("promotion").path("bindingKey").asText()).isEqualTo("default");

        PromotionRow promotionRow = jdbcTemplate.queryForObject(
            """
            SELECT eval_state,
                   eval_summary_path,
                   review_decision,
                   promoted_binding_key
              FROM npc_training_run
             WHERE run_uid = ?
            """,
            (rs, rowNum) -> new PromotionRow(
                rs.getString("eval_state"),
                rs.getString("eval_summary_path"),
                rs.getString("review_decision"),
                rs.getString("promoted_binding_key")
            ),
            runId
        );

        assertThat(promotionRow).isNotNull();
        assertThat(promotionRow.evalState()).isEqualTo("succeeded");
        assertThat(promotionRow.evalSummaryPath()).isNotBlank();
        assertThat(Files.exists(Path.of(promotionRow.evalSummaryPath()))).isTrue();
        assertThat(promotionRow.reviewDecision()).isEqualTo("accepted");
        assertThat(promotionRow.promotedBindingKey()).isEqualTo("default");
    }

    @Test
    void reviewRepositoryReturnsOnlyLatestTaskPerReviewUid() {
        String duplicatedReviewUid = "dedupe-review-" + UUID.randomUUID();
        String uniqueReviewUid = "dedupe-unique-" + UUID.randomUUID();
        Instant firstCreatedAt = Instant.parse("2026-04-18T00:00:00Z");
        Instant secondCreatedAt = Instant.parse("2026-04-18T00:01:00Z");

        jdbcTemplate.update(
            """
            INSERT INTO npc_review_task (
                review_uid,
                review_kind,
                status,
                review_required,
                current_decision,
                current_reviewed_at,
                current_notes,
                created_at,
                updated_at
            ) VALUES (?, 'sft', 'pending', TRUE, NULL, NULL, '', ?, ?)
            """,
            duplicatedReviewUid,
            utcTimestamp(firstCreatedAt.toString()),
            utcTimestamp(firstCreatedAt.toString())
        );

        jdbcTemplate.update(
            """
            INSERT INTO npc_review_task (
                review_uid,
                review_kind,
                status,
                review_required,
                current_decision,
                current_reviewer,
                current_reviewed_at,
                current_notes,
                created_at,
                updated_at
            ) VALUES (?, 'sft', 'reviewed', TRUE, 'include', 'reviewer-a', ?, 'updated', ?, ?)
            """,
            duplicatedReviewUid,
            utcTimestamp(secondCreatedAt.toString()),
            utcTimestamp(secondCreatedAt.toString()),
            utcTimestamp(secondCreatedAt.toString())
        );

        jdbcTemplate.update(
            """
            INSERT INTO npc_review_task (
                review_uid,
                review_kind,
                status,
                review_required,
                current_decision,
                current_notes,
                created_at,
                updated_at
            ) VALUES (?, 'pair', 'pending', TRUE, NULL, '', ?, ?)
            """,
            uniqueReviewUid,
            utcTimestamp(secondCreatedAt.toString()),
            utcTimestamp(secondCreatedAt.toString())
        );

        var rows = reviewRepository.findReviewTasks();

        assertThat(rows).hasSize(2);

        ReviewRepository.ReviewTaskRow duplicated = rows.stream()
            .filter(row -> duplicatedReviewUid.equals(row.reviewUid()))
            .findFirst()
            .orElseThrow();
        assertThat(duplicated.currentDecision()).isEqualTo("include");
        assertThat(duplicated.currentReviewer()).isEqualTo("reviewer-a");

        ReviewRepository.PendingCounts pendingCounts = reviewRepository.getPendingReviewCounts();
        assertThat(pendingCounts.sft()).isZero();
        assertThat(pendingCounts.pair()).isEqualTo(1);
        assertThat(pendingCounts.total()).isEqualTo(1);
    }

    @Test
    void reviewAndTrainingTimestampsRoundTripAsUtcIsoStrings() throws Exception {
        String reviewUid = "timestamp-review-" + UUID.randomUUID();
        String runUid = "timestamp-run-" + UUID.randomUUID();
        String reviewCreatedAt = "2026-04-18T00:00:00Z";
        String reviewDecidedAt = "2026-04-18T00:10:11Z";
        String trainingStartedAt = "2026-04-18T01:00:00Z";
        String trainingUpdatedAt = "2026-04-18T01:01:00Z";
        String evalStartedAt = "2026-04-18T01:02:03Z";
        String evalFinishedAt = "2026-04-18T01:03:04Z";
        String reviewedAt = "2026-04-18T01:04:05Z";
        String promotedAt = "2026-04-18T01:05:06Z";

        jdbcTemplate.update(
            """
            INSERT INTO npc_review_task (
                review_uid,
                review_kind,
                status,
                review_required,
                current_decision,
                current_reviewed_at,
                current_notes,
                created_at,
                updated_at
            ) VALUES (?, 'sft', 'pending', TRUE, NULL, NULL, '', ?, ?)
            """,
            reviewUid,
            utcTimestamp(reviewCreatedAt),
            utcTimestamp(reviewCreatedAt)
        );

        Long reviewTaskId = jdbcTemplate.queryForObject(
            "SELECT id FROM npc_review_task WHERE review_uid = ?",
            Long.class,
            reviewUid
        );
        assertThat(reviewTaskId).isNotNull();

        reviewRepository.updateReviewTaskDecision(
            reviewTaskId,
            "include",
            "timestamp-tester",
            "utc check",
            reviewDecidedAt,
            "reviewed"
        );

        ReviewRepository.ReviewTaskRow reviewTask = reviewRepository.findReviewTask(reviewUid, "sft").orElseThrow();
        assertThat(reviewTask.currentReviewedAt()).isEqualTo(reviewDecidedAt);
        assertThat(reviewTask.updatedAt()).isNotBlank();

        Timestamp rawReviewedAt = jdbcTemplate.queryForObject(
            "SELECT current_reviewed_at FROM npc_review_task WHERE id = ?",
            Timestamp.class,
            reviewTaskId
        );
        assertThat(rawReviewedAt).isNotNull();
        assertThat(rawReviewedAt.toLocalDateTime()).isEqualTo(utcLocalDateTime(reviewDecidedAt));

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
                started_at,
                created_at,
                updated_at
            ) VALUES (?, 'sft', 'succeeded', 'complete', 'done', CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)
            """,
            runUid,
            "{}",
            "{\"durations\":{\"buildMs\":1,\"trainMs\":2,\"totalMs\":3}}",
            utcTimestamp(trainingStartedAt),
            utcTimestamp(trainingStartedAt),
            utcTimestamp(trainingUpdatedAt)
        );

        reviewRepository.updateTrainingRunEvaluation(
            runUid,
            "succeeded",
            "eval done",
            "default",
            "baseline",
            "/tmp/eval-summary.json",
            objectMapper.readTree("{\"recommendation\":\"promote\"}"),
            evalStartedAt,
            evalFinishedAt
        );
        reviewRepository.updateTrainingRunReviewDecision(
            runUid,
            "accepted",
            "approved",
            "timestamp-tester",
            reviewedAt
        );
        reviewRepository.markTrainingRunPromoted(runUid, "default", promotedAt);

        ReviewRepository.TrainingRunRow trainingRun = reviewRepository.findTrainingRunByUid(runUid).orElseThrow();
        assertThat(trainingRun.startedAt()).isEqualTo(trainingStartedAt);
        assertThat(trainingRun.evalStartedAt()).isEqualTo(evalStartedAt);
        assertThat(trainingRun.evalFinishedAt()).isEqualTo(evalFinishedAt);
        assertThat(trainingRun.reviewedAt()).isEqualTo(reviewedAt);
        assertThat(trainingRun.promotedAt()).isEqualTo(promotedAt);

        MvcResult trainingStatusResult = mockMvc.perform(get("/api/review/training"))
            .andExpect(status().isOk())
            .andReturn();
        JsonNode trainingStatus = objectMapper.readTree(trainingStatusResult.getResponse().getContentAsString());
        assertThat(trainingStatus.path("latestRun").path("runId").asText()).isEqualTo(runUid);
        assertThat(trainingStatus.path("latestRun").path("startedAt").asText()).isEqualTo(trainingStartedAt);
        assertThat(trainingStatus.path("latestRun").path("evaluation").path("startedAt").asText()).isEqualTo(evalStartedAt);
        assertThat(trainingStatus.path("latestRun").path("evaluation").path("finishedAt").asText()).isEqualTo(evalFinishedAt);
        assertThat(trainingStatus.path("latestRun").path("decision").path("decidedAt").asText()).isEqualTo(reviewedAt);
        assertThat(trainingStatus.path("latestRun").path("promotion").path("promotedAt").asText()).isEqualTo(promotedAt);

        Timestamp rawEvalStartedAt = jdbcTemplate.queryForObject(
            "SELECT eval_started_at FROM npc_training_run WHERE run_uid = ?",
            Timestamp.class,
            runUid
        );
        Timestamp rawTrainingReviewedAt = jdbcTemplate.queryForObject(
            "SELECT reviewed_at FROM npc_training_run WHERE run_uid = ?",
            Timestamp.class,
            runUid
        );
        Timestamp rawPromotedAt = jdbcTemplate.queryForObject(
            "SELECT promoted_at FROM npc_training_run WHERE run_uid = ?",
            Timestamp.class,
            runUid
        );
        assertThat(rawEvalStartedAt).isNotNull();
        assertThat(rawEvalStartedAt.toLocalDateTime()).isEqualTo(utcLocalDateTime(evalStartedAt));
        assertThat(rawTrainingReviewedAt).isNotNull();
        assertThat(rawTrainingReviewedAt.toLocalDateTime()).isEqualTo(utcLocalDateTime(reviewedAt));
        assertThat(rawPromotedAt).isNotNull();
        assertThat(rawPromotedAt.toLocalDateTime()).isEqualTo(utcLocalDateTime(promotedAt));
    }

    private long seedReviewedSnapshot() throws Exception {
        Instant reviewedAt = Instant.parse("2026-04-18T00:00:00Z");
        Instant generatedAt = reviewedAt.plusSeconds(60);

        jdbcTemplate.update(
            """
            INSERT INTO npc_review_task (
                review_uid,
                review_kind,
                status,
                review_required,
                current_decision,
                current_reviewed_at,
                current_notes,
                created_at,
                updated_at
            ) VALUES (?, 'sft', 'reviewed', TRUE, 'include', ?, '', ?, ?)
            """,
            "smoke-reviewed-" + UUID.randomUUID(),
            Timestamp.from(reviewedAt),
            Timestamp.from(reviewedAt),
            Timestamp.from(reviewedAt)
        );

        String snapshotUid = "snapshot-" + UUID.randomUUID();
        jdbcTemplate.update(
            """
            INSERT INTO npc_dataset_snapshot (
                snapshot_uid,
                dataset_kind,
                dataset_version,
                snapshot_fingerprint,
                source_fingerprint,
                manifest_json,
                summary_json,
                output_uri,
                is_active,
                generated_by,
                generated_at,
                created_at
            ) VALUES (
                ?, 'sft', 'sft-smoke', 'snapshot-fingerprint', 'source-fingerprint',
                CAST(? AS JSON), CAST(? AS JSON), ?, TRUE, 'test', ?, ?
            )
            """,
            snapshotUid,
            "{\"outputFiles\":{\"manifest\":\"/tmp/sft-smoke-manifest.json\"}}",
            "{\"counts\":{\"train\":1,\"dev\":0}}",
            "/tmp/sft-smoke-manifest.json",
            Timestamp.from(generatedAt),
            Timestamp.from(generatedAt)
        );

        Long snapshotId = jdbcTemplate.queryForObject(
            "SELECT id FROM npc_dataset_snapshot WHERE snapshot_uid = ?",
            Long.class,
            snapshotUid
        );

        assertThat(snapshotId).isNotNull();

        jdbcTemplate.update(
            """
            INSERT INTO npc_dataset_snapshot_item (
                snapshot_id,
                item_kind,
                split_name,
                position_index,
                inclusion_reason,
                row_fingerprint,
                row_payload_json,
                created_at
            ) VALUES (?, 'sft_row', 'train', 0, 'test_seed', 'row-fingerprint', CAST(? AS JSON), ?)
            """,
            snapshotId,
            "{\"rowId\":\"smoke-row-1\",\"assistant\":{\"replyText\":\"테스트 응답\"},\"input\":{\"scenarioId\":\"underwater-sacrifice\"}}",
            Timestamp.from(generatedAt)
        );

        return snapshotId;
    }

    private JsonNode waitForRunCompletion(String runId) throws Exception {
        JsonNode latest = null;
        for (int attempt = 0; attempt < 25; attempt += 1) {
            MvcResult pollResult = mockMvc.perform(get("/api/review/training"))
                .andExpect(status().isOk())
                .andReturn();
            latest = objectMapper.readTree(pollResult.getResponse().getContentAsString());
            if (runId.equals(latest.path("latestRun").path("runId").asText()) &&
                !"running".equals(latest.path("latestRun").path("state").asText())) {
                return latest;
            }
            Thread.sleep(200L);
        }
        throw new AssertionError("training smoke run did not finish in time");
    }

    private Timestamp utcTimestamp(String isoString) {
        return Timestamp.valueOf(utcLocalDateTime(isoString));
    }

    private LocalDateTime utcLocalDateTime(String isoString) {
        return LocalDateTime.ofInstant(Instant.parse(isoString), ZoneOffset.UTC);
    }

    private record TrainingRunRow(
        String adapterPath,
        String adapterVersion,
        String runtimeArtifactPath,
        String runtimeArtifactKind,
        String datasetDir
    ) {}

    private record PromotionRow(
        String evalState,
        String evalSummaryPath,
        String reviewDecision,
        String promotedBindingKey
    ) {}
}
