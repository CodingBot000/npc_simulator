package com.npcsimulator.runtime;

import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

public final class RuntimeWorldHeaderResolver {

    public static final String WORLD_INSTANCE_HEADER = "x-world-instance-id";
    public static final String DEFAULT_WORLD_INSTANCE_ID = "default";
    private static final Pattern INSTANCE_ID_PATTERN =
        Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$");

    private RuntimeWorldHeaderResolver() {}

    public static String resolveInstanceId(HttpHeaders headers) {
        String raw = headers == null ? null : headers.getFirst(WORLD_INSTANCE_HEADER);
        if (raw == null || raw.isBlank()) {
            return DEFAULT_WORLD_INSTANCE_ID;
        }

        String trimmed = raw.trim();
        if (!INSTANCE_ID_PATTERN.matcher(trimmed).matches()) {
            throw new RuntimeApiException(
                HttpStatus.BAD_REQUEST,
                "Invalid x-world-instance-id header. Use 1-128 chars of letters, numbers, '_' or '-'."
            );
        }

        return trimmed;
    }
}
