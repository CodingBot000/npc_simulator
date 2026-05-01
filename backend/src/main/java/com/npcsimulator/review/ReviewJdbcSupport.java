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
import org.springframework.stereotype.Component;

@Component
class ReviewJdbcSupport {

    private final ObjectMapper objectMapper;

    ReviewJdbcSupport(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    JsonNode readJson(ResultSet rs, String columnName) throws SQLException {
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

    String writeJson(JsonNode value) {
        try {
            return value == null || value.isNull() ? null : objectMapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to serialize review JSON column.", error);
        }
    }

    Long getNullableLong(ResultSet rs, String columnName) throws SQLException {
        Object value = rs.getObject(columnName);
        return value instanceof Number number ? number.longValue() : null;
    }

    Boolean getNullableBoolean(ResultSet rs, String columnName) throws SQLException {
        Object value = rs.getObject(columnName);
        return value instanceof Boolean bool ? bool : null;
    }

    BigDecimal getNullableBigDecimal(ResultSet rs, String columnName) throws SQLException {
        return rs.getBigDecimal(columnName);
    }

    String toIsoString(Timestamp value) {
        return value == null ? null : value.toLocalDateTime().toInstant(ZoneOffset.UTC).toString();
    }

    Timestamp toTimestamp(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return Timestamp.valueOf(LocalDateTime.ofInstant(Instant.parse(value), ZoneOffset.UTC));
    }

    Timestamp utcNowTimestamp() {
        return Timestamp.valueOf(LocalDateTime.now(ZoneOffset.UTC));
    }

    ObjectNode finalizeMetricsNode(ReviewRepository.FinalizeMetrics durations, ReviewRepository.FinalizeOutputs outputs) {
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

    void setNullableNumber(ObjectNode node, String fieldName, Long value) {
        if (value == null) {
            node.putNull(fieldName);
        } else {
            node.put(fieldName, value);
        }
    }

    void setNullableText(ObjectNode node, String fieldName, String value) {
        if (value == null || value.isBlank()) {
            node.putNull(fieldName);
        } else {
            node.put(fieldName, value);
        }
    }

    Long asLong(JsonNode value) {
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

    String extractText(ObjectNode node, String fieldName) {
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? null : text;
    }

    ObjectNode object(JsonNode value) {
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

    ObjectNode createObjectNode() {
        return objectMapper.createObjectNode();
    }

    JsonNode valueToTree(Object value) {
        return objectMapper.valueToTree(value);
    }
}
