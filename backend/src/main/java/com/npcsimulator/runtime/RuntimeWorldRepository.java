package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class RuntimeWorldRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public RuntimeWorldRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public Optional<RuntimeWorldRecord> findLatest(String instanceId) {
        List<RuntimeWorldRecord> rows = jdbcTemplate.query(
            """
            SELECT id,
                   instance_id,
                   scenario_id,
                   storage_path,
                   state_version,
                   episode_uid,
                   world_state_json,
                   memory_file_json,
                   interaction_log_json
              FROM npc_world_instances
             WHERE instance_id = ?
             ORDER BY id DESC
             LIMIT 1
            """,
            (rs, rowNum) -> new RuntimeWorldRecord(
                rs.getLong("id"),
                rs.getString("instance_id"),
                rs.getString("scenario_id"),
                rs.getString("storage_path"),
                rs.getInt("state_version"),
                rs.getString("episode_uid"),
                new RuntimeWorldBundle(
                    readJson(rs.getString("world_state_json")),
                    readJson(rs.getString("memory_file_json")),
                    readJson(rs.getString("interaction_log_json"))
                )
            ),
            instanceId
        );

        return rows.stream().findFirst();
    }

    public RuntimeWorldRecord save(
        String instanceId,
        RuntimeWorldBundle bundle,
        RuntimeWorldRecord existing,
        String storagePath
    ) {
        String scenarioId = text(bundle.worldState(), "scenarioId");
        String episodeUid = text(bundle.worldState(), "episodeId");
        int nextStateVersion = existing == null ? 1 : existing.stateVersion() + 1;

        if (existing != null) {
            jdbcTemplate.update(
                """
                UPDATE npc_world_instances
                   SET scenario_id = ?,
                       storage_path = ?,
                       state_version = ?,
                       episode_uid = ?,
                       world_state_json = CAST(? AS JSON),
                       memory_file_json = CAST(? AS JSON),
                       interaction_log_json = CAST(? AS JSON),
                       updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?
                """,
                scenarioId,
                storagePath,
                nextStateVersion,
                episodeUid,
                writeJson(bundle.worldState()),
                writeJson(bundle.memoryFile()),
                writeJson(bundle.interactionLog()),
                existing.id()
            );

            return new RuntimeWorldRecord(
                existing.id(),
                instanceId,
                scenarioId,
                storagePath,
                nextStateVersion,
                episodeUid,
                copyBundle(bundle)
            );
        }

        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                """
                INSERT INTO npc_world_instances (
                    instance_id,
                    scenario_id,
                    storage_path,
                    state_version,
                    episode_uid,
                    world_state_json,
                    memory_file_json,
                    interaction_log_json
                ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
                """,
                new String[] {"id"}
            );
            statement.setString(1, instanceId);
            statement.setString(2, scenarioId);
            statement.setString(3, storagePath);
            statement.setInt(4, nextStateVersion);
            statement.setString(5, episodeUid);
            statement.setString(6, writeJson(bundle.worldState()));
            statement.setString(7, writeJson(bundle.memoryFile()));
            statement.setString(8, writeJson(bundle.interactionLog()));
            return statement;
        }, keyHolder);

        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to insert npc_world_instances row.");
        }

        return new RuntimeWorldRecord(
            key.longValue(),
            instanceId,
            scenarioId,
            storagePath,
            nextStateVersion,
            episodeUid,
            copyBundle(bundle)
        );
    }

    public boolean tryAcquireMutationLock(String instanceId) {
        Boolean acquired = jdbcTemplate.queryForObject(
            """
            SELECT pg_try_advisory_xact_lock(
                hashtext('npc_world_repository'),
                hashtext(?)
            )
            """,
            Boolean.class,
            instanceId
        );

        return Boolean.TRUE.equals(acquired);
    }

    private RuntimeWorldBundle copyBundle(RuntimeWorldBundle bundle) {
        return new RuntimeWorldBundle(
            bundle.worldState().deepCopy(),
            bundle.memoryFile().deepCopy(),
            bundle.interactionLog().deepCopy()
        );
    }

    private JsonNode readJson(String raw) {
        try {
            return objectMapper.readTree(raw);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to parse runtime world JSON column.", error);
        }
    }

    private String writeJson(JsonNode value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to serialize runtime world JSON column.", error);
        }
    }

    private String text(JsonNode node, String fieldName) {
        JsonNode value = node.get(fieldName);
        return value == null || value.isNull() ? null : value.asText();
    }
}
