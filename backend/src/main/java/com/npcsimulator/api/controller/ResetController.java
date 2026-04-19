package com.npcsimulator.api.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.npcsimulator.runtime.RuntimeApiException;
import com.npcsimulator.runtime.RuntimeWorldService;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reset")
public class ResetController {

    private final RuntimeWorldService runtimeWorldService;
    private final ObjectMapper objectMapper;

    public ResetController(RuntimeWorldService runtimeWorldService, ObjectMapper objectMapper) {
        this.runtimeWorldService = runtimeWorldService;
        this.objectMapper = objectMapper;
    }

    @PostMapping
    public ResponseEntity<String> reset(@RequestHeader HttpHeaders headers) {
        try {
            JsonNode body = runtimeWorldService.resetWorld(headers);
            return jsonResponse(ResponseEntity.ok(), body);
        } catch (RuntimeApiException error) {
            return ResponseEntity.status(error.getStatus())
                .contentType(MediaType.APPLICATION_JSON)
                .body(writeJson(Map.of("message", error.getMessage())));
        }
    }

    private ResponseEntity<String> jsonResponse(
        ResponseEntity.BodyBuilder builder,
        JsonNode body
    ) {
        return builder
            .contentType(MediaType.APPLICATION_JSON)
            .body(writeJson(body));
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to serialize reset response.", error);
        }
    }
}
