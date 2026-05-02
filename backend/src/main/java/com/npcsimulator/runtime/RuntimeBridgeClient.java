package com.npcsimulator.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.npcsimulator.infra.bridge.BridgeEnvelope;
import com.npcsimulator.infra.bridge.NodeBridgeService;
import java.util.Locale;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
class RuntimeBridgeClient {

    private final NodeBridgeService nodeBridgeService;
    private final ObjectMapper objectMapper;

    RuntimeBridgeClient(NodeBridgeService nodeBridgeService, ObjectMapper objectMapper) {
        this.nodeBridgeService = nodeBridgeService;
        this.objectMapper = objectMapper;
    }

    RuntimeWorldBundle requestSeedBundle() {
        JsonNode body = invokeBridgeBody("runtime-seed-bundle", new HttpHeaders(), null);

        JsonNode worldState = body.get("worldState");
        JsonNode memoryFile = body.get("memoryFile");
        JsonNode interactionLog = body.get("interactionLog");
        if (worldState == null || memoryFile == null || interactionLog == null) {
            throw new RuntimeApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Seed worker returned an invalid runtime world bundle."
            );
        }

        return new RuntimeWorldBundle(
            worldState.deepCopy(),
            memoryFile.deepCopy(),
            interactionLog.deepCopy()
        );
    }

    JsonNode requestInteractionWorker(JsonNode request, RuntimeWorldBundle bundle) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.set("request", request.deepCopy());

        ObjectNode bundleNode = payload.putObject("bundle");
        bundleNode.set("worldState", bundle.worldState().deepCopy());
        bundleNode.set("memoryFile", bundle.memoryFile().deepCopy());
        bundleNode.set("interactionLog", bundle.interactionLog().deepCopy());

        return invokeBridgeBody("runtime-interact-worker", new HttpHeaders(), payload);
    }

    RuntimeWorldBundle parseBundle(JsonNode bundleNode) {
        JsonNode worldState = bundleNode.get("worldState");
        JsonNode memoryFile = bundleNode.get("memoryFile");
        JsonNode interactionLog = bundleNode.get("interactionLog");
        if (worldState == null || memoryFile == null || interactionLog == null) {
            throw new RuntimeApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Interaction worker returned an invalid runtime world bundle."
            );
        }

        return new RuntimeWorldBundle(
            worldState.deepCopy(),
            memoryFile.deepCopy(),
            interactionLog.deepCopy()
        );
    }

    JsonNode invokeBridgeBody(String operation, HttpHeaders headers, Object body) {
        BridgeEnvelope result;
        try {
            result = nodeBridgeService.invoke(operation, headers, body);
        } catch (IllegalStateException error) {
            throw new RuntimeApiException(
                bridgeFailureStatus(error),
                bridgeFailureMessage(error),
                error
            );
        }

        try {
            JsonNode payload = objectMapper.readTree(result.bodyJson());
            if (result.status() >= 400) {
                throw new RuntimeApiException(
                    HttpStatus.valueOf(result.status()),
                    extractMessage(payload, "Runtime bridge request failed.")
                );
            }

            return payload;
        } catch (RuntimeApiException error) {
            throw error;
        } catch (Exception error) {
            throw new RuntimeApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to parse runtime bridge response.",
                error
            );
        }
    }

    private HttpStatus bridgeFailureStatus(IllegalStateException error) {
        String message = error.getMessage();
        if (message != null && message.toLowerCase(Locale.ROOT).contains("timed out")) {
            return HttpStatus.GATEWAY_TIMEOUT;
        }

        return HttpStatus.BAD_GATEWAY;
    }

    private String bridgeFailureMessage(IllegalStateException error) {
        String message = error.getMessage();
        if (message != null && message.toLowerCase(Locale.ROOT).contains("timed out")) {
            return "답변 생성 시간이 초과되었습니다. 잠시 후 다시 시도하거나 NPC_SIMULATOR_BRIDGE_TIMEOUT_SECONDS 값을 늘려주세요.";
        }

        return message == null || message.isBlank()
            ? "Runtime bridge request failed."
            : message;
    }

    private String extractMessage(JsonNode payload, String fallback) {
        JsonNode message = payload.get("message");
        return message == null || message.isNull() ? fallback : message.asText(fallback);
    }
}
