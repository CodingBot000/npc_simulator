package com.npcsimulator.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final String[] allowedOrigins;

    public CorsConfig(
        @Value("${npc-simulator.cors.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}") String allowedOrigins
    ) {
        this.allowedOrigins = allowedOrigins
            .trim()
            .isEmpty()
            ? new String[0]
            : allowedOrigins.split("\\s*,\\s*");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins(allowedOrigins)
            .allowedMethods("GET", "POST", "PATCH", "OPTIONS")
            .allowedHeaders("*");
    }
}
