package com.npcsimulator.analytics;

import com.npcsimulator.api.dto.VisitorEventRequest;
import com.npcsimulator.runtime.RuntimeApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class VisitorAnalyticsService {

    private final VisitorAnalyticsRepository repository;
    private final String ownerToken;

    public VisitorAnalyticsService(
        VisitorAnalyticsRepository repository,
        @Value("${NPC_SIMULATOR_OWNER_TOKEN:}") String ownerToken
    ) {
        this.repository = repository;
        this.ownerToken = normalize(ownerToken);
    }

    public VisitorEventResponse recordEvent(String visitorId, VisitorEventRequest request) {
        boolean owner = repository.isOwner(visitorId);
        repository.recordEvent(
            visitorId,
            request.eventType(),
            owner,
            request.worldInstanceId(),
            request.metadata()
        );
        return new VisitorEventResponse(visitorId, owner, request.eventType());
    }

    public OwnerRegistrationResponse registerOwner(String visitorId, String token) {
        String requestToken = normalize(token);
        if (ownerToken.isEmpty() || requestToken.isEmpty() || !constantTimeEquals(ownerToken, requestToken)) {
            throw new RuntimeApiException(HttpStatus.FORBIDDEN, "Owner token is invalid or not configured.");
        }

        repository.registerOwner(visitorId);
        repository.recordEvent(visitorId, "owner_registered", true, null, null);
        return new OwnerRegistrationResponse(visitorId, true);
    }

    private boolean constantTimeEquals(String expected, String actual) {
        byte[] expectedBytes = expected.getBytes(StandardCharsets.UTF_8);
        byte[] actualBytes = actual.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expectedBytes, actualBytes);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    public record VisitorEventResponse(
        String visitorId,
        boolean owner,
        String eventType
    ) {}

    public record OwnerRegistrationResponse(
        String visitorId,
        boolean owner
    ) {}
}
