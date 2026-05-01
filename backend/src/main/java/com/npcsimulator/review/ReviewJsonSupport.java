package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
class ReviewJsonSupport {

    private final ObjectMapper objectMapper;

    ReviewJsonSupport(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
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
                // Fall back to an empty object when legacy JSON text cannot be re-parsed.
            }
        }
        return objectMapper.createObjectNode();
    }

    String requiredText(JsonNode payload, String fieldName, String message) {
        String value = trimToNull(extractText(payload, fieldName));
        if (value == null) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, message);
        }
        return value;
    }

    String requiredEnum(JsonNode payload, String fieldName, List<String> values, String message) {
        String value = requiredText(payload, fieldName, message);
        if (!values.contains(value)) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, message);
        }
        return value;
    }

    String optionalEnum(JsonNode payload, String fieldName, List<String> values, String message) {
        String value = trimToNull(extractText(payload, fieldName));
        if (value == null) {
            return null;
        }
        if (!values.contains(value)) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, message);
        }
        return value;
    }

    Integer optionalPositiveInteger(JsonNode payload, String fieldName, String message) {
        JsonNode value = payload.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isIntegralNumber() || value.asInt() < 1) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, message);
        }
        return value.asInt();
    }

    boolean optionalBoolean(JsonNode payload, String fieldName, boolean fallback) {
        JsonNode value = payload.get(fieldName);
        if (value == null || value.isNull()) {
            return fallback;
        }
        if (!value.isBoolean()) {
            throw new ReviewApiException(HttpStatus.BAD_REQUEST, fieldName + " must be a boolean.");
        }
        return value.asBoolean();
    }

    String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    String blankToNull(String value) {
        return trimToNull(value);
    }

    String extractText(JsonNode node, String fieldName) {
        return extractText(node, fieldName, null);
    }

    String extractText(JsonNode node, String fieldName, String fallback) {
        if (node == null) {
            return fallback;
        }
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return fallback;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? fallback : text;
    }

    Number extractNumber(JsonNode node, String fieldName) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        if (value.isIntegralNumber()) {
            return value.asLong();
        }
        if (value.isFloatingPointNumber()) {
            return value.decimalValue();
        }
        if (value.isTextual()) {
            try {
                return new BigDecimal(value.asText());
            } catch (NumberFormatException error) {
                return null;
            }
        }
        return null;
    }

    JsonNode nullableTextNode(String value) {
        return value == null ? NullNode.instance : objectMapper.getNodeFactory().textNode(value);
    }

    JsonNode nullableNumberNode(Number value) {
        if (value == null) {
            return NullNode.instance;
        }
        if (value instanceof Integer integer) {
            return objectMapper.getNodeFactory().numberNode(integer);
        }
        if (value instanceof Long longValue) {
            return objectMapper.getNodeFactory().numberNode(longValue);
        }
        if (value instanceof BigDecimal decimal) {
            return objectMapper.getNodeFactory().numberNode(decimal);
        }
        if (value instanceof Double doubleValue) {
            return objectMapper.getNodeFactory().numberNode(doubleValue);
        }
        return objectMapper.getNodeFactory().numberNode(value.doubleValue());
    }

    String defaultText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    boolean blank(String value) {
        return value == null || value.isBlank();
    }

    String firstNonBlank(String first, String second) {
        return !blank(first) ? first : (!blank(second) ? second : null);
    }

    String newestTimestamp(String first, String second) {
        if (first == null) {
            return second;
        }
        if (second == null) {
            return first;
        }
        return java.time.Instant.parse(first).isAfter(java.time.Instant.parse(second)) ? first : second;
    }

    ObjectNode pendingNode(ReviewRepository.PendingCounts pending) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("sft", pending.sft());
        node.put("pair", pending.pair());
        node.put("total", pending.total());
        return node;
    }
}

