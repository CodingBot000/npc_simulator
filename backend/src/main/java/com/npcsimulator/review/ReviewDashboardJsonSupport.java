package com.npcsimulator.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import org.springframework.stereotype.Component;

@Component
class ReviewDashboardJsonSupport {

    private final ObjectMapper objectMapper;

    ReviewDashboardJsonSupport(ObjectMapper objectMapper) {
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

    JsonNode copyOrNull(JsonNode value) {
        return value == null || value.isNull() ? NullNode.instance : value.deepCopy();
    }

    ArrayNode stringArray(JsonNode value, int limit) {
        ArrayNode array = objectMapper.createArrayNode();
        if (value == null || !value.isArray()) {
            return array;
        }
        int count = 0;
        for (JsonNode entry : value) {
            if (entry.isTextual()) {
                array.add(entry.asText());
                count += 1;
                if (count >= limit) {
                    break;
                }
            }
        }
        return array;
    }

    ArrayNode extractNestedStringArray(JsonNode value, String fieldName, int limit) {
        ArrayNode array = objectMapper.createArrayNode();
        if (value == null || !value.isArray()) {
            return array;
        }
        int count = 0;
        for (JsonNode entry : value) {
            String text = extractText(object(entry), fieldName);
            if (text != null) {
                array.add(text);
                count += 1;
                if (count >= limit) {
                    break;
                }
            }
        }
        return array;
    }

    ArrayNode extractKnowledgeTitles(JsonNode value, int limit) {
        ArrayNode array = objectMapper.createArrayNode();
        if (value == null || !value.isArray()) {
            return array;
        }
        int count = 0;
        for (JsonNode entry : value) {
            ObjectNode object = object(entry);
            String text = firstNonBlank(extractText(object, "title"), extractText(object, "summary"));
            if (text != null) {
                array.add(text);
                count += 1;
                if (count >= limit) {
                    break;
                }
            }
        }
        return array;
    }

    String extractText(JsonNode node, String fieldName) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(fieldName);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? null : text;
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

    <T> T firstNonNull(T first, T second) {
        return first != null ? first : second;
    }

    String firstNonBlank(String first, String second) {
        return !blank(first) ? first : (!blank(second) ? second : null);
    }
}
