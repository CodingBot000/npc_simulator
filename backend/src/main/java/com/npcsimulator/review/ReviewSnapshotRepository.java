package com.npcsimulator.review;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ReviewSnapshotRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ReviewRepositoryRowMapper rowMapper;

    ReviewSnapshotRepository(JdbcTemplate jdbcTemplate, ReviewRepositoryRowMapper rowMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.rowMapper = rowMapper;
    }

    Optional<ReviewRepository.SnapshotSummaryRow> findActiveSnapshot(String datasetKind) {
        List<ReviewRepository.SnapshotSummaryRow> rows = jdbcTemplate.query(
            """
            SELECT *
              FROM npc_dataset_snapshot
             WHERE dataset_kind = ?
               AND is_active = TRUE
             ORDER BY CASE WHEN generated_at IS NULL THEN 1 ELSE 0 END, generated_at DESC, id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> rowMapper.mapSnapshotSummaryRow(rs),
            datasetKind
        );
        return rows.stream().findFirst();
    }

    int countSnapshotItems(long snapshotId) {
        List<Integer> counts = jdbcTemplate.query(
            "SELECT COUNT(*) AS count FROM npc_dataset_snapshot_item WHERE snapshot_id = ?",
            (rs, rowNum) -> rs.getInt("count"),
            snapshotId
        );
        return counts.isEmpty() ? 0 : counts.get(0);
    }
}
