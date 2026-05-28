package com.npcsimulator.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class VisitorAnalyticsRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public VisitorAnalyticsRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public boolean isOwner(String visitorId) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM npc_visitor_owner WHERE visitor_id = ?",
            Integer.class,
            visitorId
        );
        return count != null && count > 0;
    }

    public void registerOwner(String visitorId) {
        if (isOwner(visitorId)) {
            jdbcTemplate.update(
                """
                UPDATE npc_visitor_owner
                   SET last_seen_at = CURRENT_TIMESTAMP
                 WHERE visitor_id = ?
                """,
                visitorId
            );
            return;
        }

        jdbcTemplate.update(
            """
            INSERT INTO npc_visitor_owner (visitor_id)
            VALUES (?)
            """,
            visitorId
        );
    }

    public void recordEvent(
        String visitorId,
        String eventType,
        boolean owner,
        String worldInstanceId,
        Map<String, Object> metadata
    ) {
        jdbcTemplate.update(
            """
            INSERT INTO npc_visitor_event (
                visitor_id,
                event_type,
                is_owner,
                world_instance_id,
                metadata_json
            ) VALUES (?, ?, ?, ?, CAST(? AS JSON))
            """,
            visitorId,
            eventType,
            owner,
            blankToNull(worldInstanceId),
            writeJson(metadata)
        );
    }

    private String writeJson(Map<String, Object> metadata) {
        try {
            return objectMapper.writeValueAsString(metadata == null ? Map.of() : metadata);
        } catch (Exception error) {
            throw new IllegalArgumentException("Failed to serialize visitor event metadata.", error);
        }
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
