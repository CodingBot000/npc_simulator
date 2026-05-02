package com.npcsimulator.review;

import com.npcsimulator.support.DeploymentModeProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class ReviewAdminGuard {

    public static final String ADMIN_TOKEN_HEADER = "X-NPC-ADMIN-TOKEN";
    private static final String FORBIDDEN_MESSAGE =
        "Review admin operation is disabled on public deployment.";

    private final DeploymentModeProperties deploymentModeProperties;
    private final String adminToken;

    public ReviewAdminGuard(
        DeploymentModeProperties deploymentModeProperties,
        @Value("${NPC_SIMULATOR_ADMIN_TOKEN:}") String adminToken
    ) {
        this.deploymentModeProperties = deploymentModeProperties;
        this.adminToken = normalize(adminToken);
    }

    public void requireAdmin(HttpHeaders headers) {
        if (deploymentModeProperties.isLocal()) {
            return;
        }

        String requestToken = normalize(headers.getFirst(ADMIN_TOKEN_HEADER));
        if (adminToken.isEmpty() || requestToken.isEmpty() || !constantTimeEquals(adminToken, requestToken)) {
            throw new ReviewApiException(HttpStatus.FORBIDDEN, FORBIDDEN_MESSAGE);
        }
    }

    private boolean constantTimeEquals(String expected, String actual) {
        byte[] expectedBytes = expected.getBytes(StandardCharsets.UTF_8);
        byte[] actualBytes = actual.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expectedBytes, actualBytes);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
