package com.npcsimulator.support;

import java.util.Arrays;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class DeploymentModeProperties {

    private final String mode;

    public DeploymentModeProperties(Environment environment) {
        this.mode = resolveMode(environment);
    }

    public String mode() {
        return mode;
    }

    public boolean isLocal() {
        return "local".equals(mode);
    }

    public boolean isCloud() {
        return "cloud".equals(mode);
    }

    private String resolveMode(Environment environment) {
        String explicitMode = firstNonBlank(
            environment.getProperty("NPC_SIMULATOR_DEPLOYMENT_MODE"),
            environment.getProperty("npc-simulator.deployment-mode"),
            environment.getProperty("NPC_SIMULATOR_SERVER_MODE"),
            environment.getProperty("npc-simulator.server-mode")
        );

        if ("cloud".equals(normalize(explicitMode))) {
            return "cloud";
        }
        if ("local".equals(normalize(explicitMode))) {
            return "local";
        }

        boolean prodProfile = Arrays.stream(environment.getActiveProfiles())
            .anyMatch((profile) -> "prod".equals(normalize(profile)));
        String configuredProfiles = environment.getProperty("spring.profiles.active", "");
        boolean configuredProdProfile = Arrays.stream(configuredProfiles.split(","))
            .anyMatch((profile) -> "prod".equals(normalize(profile)));

        return prodProfile || configuredProdProfile ? "cloud" : "local";
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase();
    }
}
