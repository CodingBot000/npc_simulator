package com.npcsimulator.api.controller;

import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest
class BridgeApiIntegrationTests {

    @Autowired
    private WebApplicationContext webApplicationContext;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        this.mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
    }

    @Test
    void resetEndpointReturnsWorldSnapshotShape() throws Exception {
        String instanceId = "test-reset-" + UUID.randomUUID();

        mockMvc
            .perform(
                post("/api/reset")
                    .header("x-world-instance-id", instanceId)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.episodeId").isString())
            .andExpect(jsonPath("$.scenarioId").value("underwater-sacrifice"))
            .andExpect(jsonPath("$.scoring.minRoundsBeforeResolution").isNumber())
            .andExpect(jsonPath("$.scoring.maxRounds").isNumber())
            .andExpect(jsonPath("$.scoring.instantConsensusVotes").isNumber())
            .andExpect(jsonPath("$.scoring.leadGapThreshold").isNumber())
            .andExpect(jsonPath("$.world.location").isString())
            .andExpect(jsonPath("$.npcs[0].persona.id").isString())
            .andExpect(jsonPath("$.runtime.providerMode").isString());

        mockMvc
            .perform(
                get("/api/world")
                    .header("x-world-instance-id", instanceId)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.episodeId").isString())
            .andExpect(jsonPath("$.availableActions[0].id").isString())
            .andExpect(jsonPath("$.presentation.appTitle").isString())
            .andExpect(jsonPath("$.scoring.leadGapThreshold").isNumber());
    }

    @Test
    void interactEndpointReturnsInspectorAndWorldProgress() throws Exception {
        String instanceId = "test-interact-" + UUID.randomUUID();

        mockMvc.perform(post("/api/reset").header("x-world-instance-id", instanceId))
            .andExpect(status().isOk());

        mockMvc
            .perform(
                post("/api/interact")
                    .header("x-world-instance-id", instanceId)
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "playerId": "local-player",
                          "npcId": "engineer",
                          "targetNpcId": "supervisor",
                          "inputMode": "free_text",
                          "action": null,
                          "text": "안전 예산 삭감 문서가 나온 이상 감독관 책임을 먼저 봐야 합니다."
                        }
                        """
                    )
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.world.round.currentRound").value(1))
            .andExpect(jsonPath("$.world.scoring.leadGapThreshold").isNumber())
            .andExpect(jsonPath("$.inspector.autonomyPhase.executed").isBoolean())
            .andExpect(jsonPath("$.inspector.autonomyPhase.steps").isArray())
            .andExpect(jsonPath("$.inspector.structuredImpact.impactTags").isArray())
            .andExpect(jsonPath("$.reply.text").isString());

        mockMvc
            .perform(
                get("/api/inspector")
                    .header("x-world-instance-id", instanceId)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.inspector.episodeId").isString())
            .andExpect(jsonPath("$.inspector.npcId").value("engineer"));
    }

    @Test
    void reviewEndpointsReturnDashboardAndStatusShapes() throws Exception {
        mockMvc
            .perform(get("/api/review"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.humanRequired.sftItems").isArray())
            .andExpect(jsonPath("$.humanRequired.pairItems").isArray())
            .andExpect(jsonPath("$.llmCompleted.sftItems").isArray())
            .andExpect(jsonPath("$.llmCompleted.pairItems").isArray());

        mockMvc
            .perform(get("/api/review/finalize"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").isString())
            .andExpect(jsonPath("$.pending.total").isNumber())
            .andExpect(jsonPath("$.durations").exists());

        mockMvc
            .perform(get("/api/review/training"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sft.kind").value("sft"))
            .andExpect(jsonPath("$.dpo.kind").value("dpo"))
            .andExpect(jsonPath("$.sft.blockingIssues").isArray())
            .andExpect(jsonPath("$.dpo.blockingIssues").isArray());

        mockMvc
            .perform(get("/api/review/pipeline"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reviewTasks.pending.total").isNumber())
            .andExpect(jsonPath("$.judge.exists").isBoolean())
            .andExpect(jsonPath("$.humanQueue.exists").isBoolean())
            .andExpect(jsonPath("$.llmFirstPass.exists").isBoolean());
    }
}
