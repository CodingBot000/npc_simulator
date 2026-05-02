package com.npcsimulator.api.controller;

import com.npcsimulator.runtime.RuntimeWorldService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reset")
public class ResetController {

    private final RuntimeWorldService runtimeWorldService;
    private final JsonResponseWriter jsonResponseWriter;

    public ResetController(
        RuntimeWorldService runtimeWorldService,
        JsonResponseWriter jsonResponseWriter
    ) {
        this.runtimeWorldService = runtimeWorldService;
        this.jsonResponseWriter = jsonResponseWriter;
    }

    @PostMapping
    public ResponseEntity<String> reset(@RequestHeader HttpHeaders headers) {
        return jsonResponseWriter.ok(runtimeWorldService.resetWorld(headers));
    }
}
