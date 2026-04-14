package com.npcsimulator.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.npcsimulator.infra.bridge.BridgeEnvelope;
import com.npcsimulator.infra.bridge.NodeBridgeService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reset")
public class ResetController {

    private final NodeBridgeService nodeBridgeService;

    public ResetController(NodeBridgeService nodeBridgeService) {
        this.nodeBridgeService = nodeBridgeService;
    }

    @PostMapping
    public ResponseEntity<JsonNode> reset(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("reset", headers, null);
        return ResponseEntity.status(result.status()).body(result.body());
    }
}
