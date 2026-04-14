package com.npcsimulator.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.npcsimulator.infra.bridge.BridgeEnvelope;
import com.npcsimulator.infra.bridge.NodeBridgeService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/inspector")
public class InspectorController {

    private final NodeBridgeService nodeBridgeService;

    public InspectorController(NodeBridgeService nodeBridgeService) {
        this.nodeBridgeService = nodeBridgeService;
    }

    @GetMapping
    public ResponseEntity<JsonNode> inspector(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("inspector", headers, null);
        return ResponseEntity.status(result.status()).body(result.body());
    }
}
