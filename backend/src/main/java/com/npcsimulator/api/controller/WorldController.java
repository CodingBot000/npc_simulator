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
@RequestMapping("/api/world")
public class WorldController {

    private final NodeBridgeService nodeBridgeService;

    public WorldController(NodeBridgeService nodeBridgeService) {
        this.nodeBridgeService = nodeBridgeService;
    }

    @GetMapping
    public ResponseEntity<JsonNode> getWorld(@RequestHeader HttpHeaders headers) {
        BridgeEnvelope result = nodeBridgeService.invoke("world", headers, null);
        return ResponseEntity.status(result.status()).body(result.body());
    }
}
