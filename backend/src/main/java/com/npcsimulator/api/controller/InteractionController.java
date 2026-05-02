package com.npcsimulator.api.controller;

import com.npcsimulator.api.dto.InteractionRequest;
import com.npcsimulator.runtime.RuntimeWorldService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
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
    private final JsonResponseWriter jsonResponseWriter;

    public InteractionController(
        RuntimeWorldService runtimeWorldService,
        JsonResponseWriter jsonResponseWriter
    ) {
        this.runtimeWorldService = runtimeWorldService;
        this.jsonResponseWriter = jsonResponseWriter;
    }

    @PostMapping
    public ResponseEntity<String> interact(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody InteractionRequest body
    ) {
        return jsonResponseWriter.ok(runtimeWorldService.interact(headers, body));
    }
}
