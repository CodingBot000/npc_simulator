package com.npcsimulator.analytics;

import com.npcsimulator.runtime.RuntimeApiException;
import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

public final class VisitorAnalyticsHeaderResolver {

    public static final String VISITOR_ID_HEADER = "X-NPC-Visitor-Id";
    private static final Pattern VISITOR_ID_PATTERN =
        Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$");

    private VisitorAnalyticsHeaderResolver() {}

    public static String requireVisitorId(HttpHeaders headers) {
        String raw = headers == null ? null : headers.getFirst(VISITOR_ID_HEADER);
        if (raw == null || raw.isBlank()) {
            throw new RuntimeApiException(
                HttpStatus.BAD_REQUEST,
                "Missing X-NPC-Visitor-Id header."
            );
        }

        String trimmed = raw.trim();
        if (!VISITOR_ID_PATTERN.matcher(trimmed).matches()) {
            throw new RuntimeApiException(
                HttpStatus.BAD_REQUEST,
                "Invalid X-NPC-Visitor-Id header. Use 1-128 chars of letters, numbers, '_' or '-'."
            );
        }

        return trimmed;
    }
}
