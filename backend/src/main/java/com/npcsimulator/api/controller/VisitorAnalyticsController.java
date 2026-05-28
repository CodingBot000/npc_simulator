package com.npcsimulator.api.controller;

import com.npcsimulator.analytics.VisitorAnalyticsHeaderResolver;
import com.npcsimulator.analytics.VisitorAnalyticsService;
import com.npcsimulator.api.dto.OwnerRegistrationRequest;
import com.npcsimulator.api.dto.VisitorEventRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/visitor")
public class VisitorAnalyticsController {

    private final JsonResponseWriter jsonResponseWriter;
    private final VisitorAnalyticsService visitorAnalyticsService;

    public VisitorAnalyticsController(
        JsonResponseWriter jsonResponseWriter,
        VisitorAnalyticsService visitorAnalyticsService
    ) {
        this.jsonResponseWriter = jsonResponseWriter;
        this.visitorAnalyticsService = visitorAnalyticsService;
    }

    @PostMapping("/events")
    public ResponseEntity<String> recordEvent(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody VisitorEventRequest body
    ) {
        String visitorId = VisitorAnalyticsHeaderResolver.requireVisitorId(headers);
        return jsonResponseWriter.ok(visitorAnalyticsService.recordEvent(visitorId, body));
    }

    @PostMapping("/owner")
    public ResponseEntity<String> registerOwner(
        @RequestHeader HttpHeaders headers,
        @Valid @RequestBody OwnerRegistrationRequest body
    ) {
        String visitorId = VisitorAnalyticsHeaderResolver.requireVisitorId(headers);
        return jsonResponseWriter.ok(visitorAnalyticsService.registerOwner(visitorId, body.token()));
    }
}
