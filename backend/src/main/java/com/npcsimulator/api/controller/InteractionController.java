package com.npcsimulator.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.npcsimulator.runtime.RuntimeApiException;
import com.npcsimulator.runtime.RuntimeWorldService;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/interact")
public class InteractionController {

    private final RuntimeWorldService runtimeWorldService;
    private final ObjectMapper objectMapper;

    public InteractionController(RuntimeWorldService runtimeWorldService, ObjectMapper objectMapper) {
        this.runtimeWorldService = runtimeWorldService;
        this.objectMapper = objectMapper;
    }

    @PostMapping
    public ResponseEntity<String> interact(
        @RequestHeader HttpHeaders headers,
        @RequestBody Map<String, Object> body
    ) {
        try {
            JsonNode result = runtimeWorldService.interact(headers, body);
            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(writeJson(result));
        } catch (RuntimeApiException error) {
            return ResponseEntity.status(error.getStatus())
                .contentType(MediaType.APPLICATION_JSON)
                .body(writeJson(Map.of("message", error.getMessage())));
        }
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to serialize interaction response.", error);
        }
    }
}
