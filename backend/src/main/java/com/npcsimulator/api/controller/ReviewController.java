package com.npcsimulator.api.controller;

import com.npcsimulator.infra.bridge.BridgeEnvelope;
import com.npcsimulator.infra.bridge.NodeBridgeService;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
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
    public ResponseEntity<String> getDashboard(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("review-dashboard", headers, null);
        return ResponseEntity.status(result.status())
            .contentType(MediaType.APPLICATION_JSON)
            .body(result.bodyJson());
    }

    @PatchMapping
    public ResponseEntity<String> updateDecision(
        @RequestHeader HttpHeaders headers,
        @RequestBody Map<String, Object> body
    ) {
        BridgeEnvelope result = nodeBridgeService.invoke("review-update", headers, body);
        return ResponseEntity.status(result.status())
            .contentType(MediaType.APPLICATION_JSON)
            .body(result.bodyJson());
    }

    @GetMapping("/finalize")
    public ResponseEntity<String> getFinalizeStatus(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("review-finalize-status", headers, null);
        return ResponseEntity.status(result.status())
            .contentType(MediaType.APPLICATION_JSON)
            .body(result.bodyJson());
    }

    @PostMapping("/finalize")
    public ResponseEntity<String> runFinalize(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("review-finalize-run", headers, null);
        return ResponseEntity.status(result.status())
            .contentType(MediaType.APPLICATION_JSON)
            .body(result.bodyJson());
    }
}
