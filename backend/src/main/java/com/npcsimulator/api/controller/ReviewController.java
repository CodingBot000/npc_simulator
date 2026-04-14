package com.npcsimulator.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.npcsimulator.infra.bridge.BridgeEnvelope;
import com.npcsimulator.infra.bridge.NodeBridgeService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/review")
public class ReviewController {

    private final NodeBridgeService nodeBridgeService;

    public ReviewController(NodeBridgeService nodeBridgeService) {
        this.nodeBridgeService = nodeBridgeService;
    }

    @GetMapping
    public ResponseEntity<JsonNode> getDashboard(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("review-dashboard", headers, null);
        return ResponseEntity.status(result.status()).body(result.body());
    }

    @PatchMapping
    public ResponseEntity<JsonNode> updateDecision(
        @RequestHeader HttpHeaders headers,
        @RequestBody JsonNode body
    ) {
        BridgeEnvelope result = nodeBridgeService.invoke("review-update", headers, body);
        return ResponseEntity.status(result.status()).body(result.body());
    }

    @GetMapping("/finalize")
    public ResponseEntity<JsonNode> getFinalizeStatus(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("review-finalize-status", headers, null);
        return ResponseEntity.status(result.status()).body(result.body());
    }

    @PostMapping("/finalize")
    public ResponseEntity<JsonNode> runFinalize(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("review-finalize-run", headers, null);
        return ResponseEntity.status(result.status()).body(result.body());
    }
}
