package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ReviewTaskRepository {

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
    private final ReviewJdbcSupport jdbcSupport;
    private final ReviewRepositoryRowMapper rowMapper;

    ReviewTaskRepository(
        JdbcTemplate jdbcTemplate,
        ReviewJdbcSupport jdbcSupport,
        ReviewRepositoryRowMapper rowMapper
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.jdbcSupport = jdbcSupport;
        this.rowMapper = rowMapper;
    }

    List<ReviewRepository.ReviewTaskRow> findReviewTasks() {
        return jdbcTemplate.query(
            "SELECT t.* " + LATEST_REVIEW_TASKS_FROM + " ORDER BY t.created_at ASC, t.id ASC",
            (rs, rowNum) -> rowMapper.mapReviewTaskRow(rs)
        );
    }

    Optional<ReviewRepository.ReviewTaskRow> findReviewTask(String reviewUid, String reviewKind) {
        List<ReviewRepository.ReviewTaskRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_review_task
             WHERE review_uid = ?
               AND review_kind = ?
             ORDER BY id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> rowMapper.mapReviewTaskRow(rs),
            reviewUid,
            reviewKind
        );
        return rows.stream().findFirst();
    }

    List<ReviewRepository.CandidateRow> findCandidates() {
        return jdbcTemplate.query(
            "SELECT * FROM npc_sft_candidate",
            (rs, rowNum) -> rowMapper.mapCandidateRow(rs)
        );
    }

    Optional<ReviewRepository.CandidateRow> findCandidate(long id) {
        List<ReviewRepository.CandidateRow> rows = jdbcTemplate.query(
            "SELECT * FROM npc_sft_candidate WHERE id = ? ORDER BY id DESC LIMIT 1",
            (rs, rowNum) -> rowMapper.mapCandidateRow(rs),
            id
        );
        return rows.stream().findFirst();
    }

    List<ReviewRepository.PairRow> findPairs() {
        return jdbcTemplate.query(
            "SELECT * FROM npc_preference_pair",
            (rs, rowNum) -> rowMapper.mapPairRow(rs)
        );
    }

    Optional<ReviewRepository.PairRow> findPair(long id) {
        List<ReviewRepository.PairRow> rows = jdbcTemplate.query(
            "SELECT * FROM npc_preference_pair WHERE id = ? ORDER BY id DESC LIMIT 1",
            (rs, rowNum) -> rowMapper.mapPairRow(rs),
            id
        );
        return rows.stream().findFirst();
    }

    ReviewRepository.PendingCounts getPendingReviewCounts() {
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

        return new ReviewRepository.PendingCounts(sft, pair, sft + pair);
    }

    String getLatestReviewUpdatedAt() {
        List<String> rows = jdbcTemplate.query(
            """
            SELECT MAX(latest_tasks.current_reviewed_at) AS updated_at
              FROM (
                SELECT t.current_reviewed_at
                """ + LATEST_REVIEW_TASKS_FROM + """
              ) latest_tasks
            """,
            (rs, rowNum) -> jdbcSupport.toIsoString(rs.getTimestamp("updated_at"))
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    void updateReviewTaskDecision(
        long taskId,
        String decision,
        String reviewer,
        String notes,
        String reviewedAt,
        String nextStatus
    ) {
        java.sql.Timestamp now = jdbcSupport.utcNowTimestamp();
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
            jdbcSupport.toTimestamp(reviewedAt),
            nextStatus,
            now,
            taskId
        );
    }

    void insertReviewDecisionEvent(
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
            jdbcSupport.writeJson(checklist),
            jdbcSupport.toTimestamp(decidedAt)
        );
    }

    private record PendingCountRow(String reviewKind, long pendingCount) {}
}
