package com.npcsimulator.api.controller;

import static org.springframework.http.MediaType.APPLICATION_JSON;
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
        mockMvc
            .perform(
                post("/api/reset")
                    .header("x-world-instance-id", "test-reset-" + UUID.randomUUID())
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.episodeId").isString())
            .andExpect(jsonPath("$.scenarioId").value("underwater-sacrifice"))
            .andExpect(jsonPath("$.world.location").isString())
            .andExpect(jsonPath("$.npcs[0].persona.id").isString());
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
            .andExpect(jsonPath("$.inspector.structuredImpact.impactTags").isArray())
            .andExpect(jsonPath("$.reply.text").isString());
    }
}
