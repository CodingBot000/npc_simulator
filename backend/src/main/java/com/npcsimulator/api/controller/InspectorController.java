package com.npcsimulator.api.controller;

import com.npcsimulator.runtime.RuntimeWorldService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/inspector")
public class InspectorController {

    private final RuntimeWorldService runtimeWorldService;
    private final JsonResponseWriter jsonResponseWriter;

    public InspectorController(
        RuntimeWorldService runtimeWorldService,
        JsonResponseWriter jsonResponseWriter
    ) {
        this.runtimeWorldService = runtimeWorldService;
        this.jsonResponseWriter = jsonResponseWriter;
    }

    @GetMapping
    public ResponseEntity<String> inspector(@RequestHeader HttpHeaders headers) {
        return jsonResponseWriter.ok(runtimeWorldService.getInspector(headers));
    }
}
