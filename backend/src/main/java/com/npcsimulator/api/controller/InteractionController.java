package com.npcsimulator.api.controller;

import com.npcsimulator.infra.bridge.BridgeEnvelope;
import com.npcsimulator.infra.bridge.NodeBridgeService;
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

    private final NodeBridgeService nodeBridgeService;

    public InteractionController(NodeBridgeService nodeBridgeService) {
        this.nodeBridgeService = nodeBridgeService;
    }

    @PostMapping
    public ResponseEntity<String> interact(
        @RequestHeader HttpHeaders headers,
        @RequestBody Map<String, Object> body
    ) {
        BridgeEnvelope result = nodeBridgeService.invoke("interact", headers, body);
        return ResponseEntity.status(result.status())
            .contentType(MediaType.APPLICATION_JSON)
            .body(result.bodyJson());
    }
}
