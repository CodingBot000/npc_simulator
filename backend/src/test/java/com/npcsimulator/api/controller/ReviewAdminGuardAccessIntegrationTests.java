package com.npcsimulator.api.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.npcsimulator.review.ReviewAdminGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest(properties = {
    "NPC_SIMULATOR_DEPLOYMENT_MODE=cloud",
    "NPC_SIMULATOR_ADMIN_TOKEN=test-admin-token",
    "LOCAL_TRAINING_EXECUTION_MODE=smoke",
    "LOCAL_TRAINING_EVAL_MODE=smoke"
})
class ReviewAdminGuardAccessIntegrationTests {

    @Autowired
    private WebApplicationContext webApplicationContext;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        this.mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
    }

    @Test
    void reviewReadEndpointsRemainPublicInCloudMode() throws Exception {
        mockMvc
            .perform(get("/api/review"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.humanRequired.sftItems").isArray())
            .andExpect(jsonPath("$.humanRequired.pairItems").isArray());

        mockMvc
            .perform(get("/api/review/finalize"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").isString());

        mockMvc
            .perform(get("/api/review/training"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sft.kind").value("sft"));

        mockMvc
            .perform(get("/api/review/pipeline"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reviewTasks.pending.total").isNumber());
    }

    @Test
    void reviewAdminEndpointsRejectMissingTokenInCloudMode() throws Exception {
        expectForbidden(mockMvc.perform(patchReviewDecision()));
        expectForbidden(mockMvc.perform(post("/api/review/finalize")));
        expectForbidden(mockMvc.perform(postReviewTraining()));
        expectForbidden(mockMvc.perform(postReviewTrainingEvaluation()));
        expectForbidden(mockMvc.perform(postReviewTrainingDecision()));
        expectForbidden(mockMvc.perform(postReviewTrainingPromote()));
        expectForbidden(mockMvc.perform(post("/api/review/pipeline/judge")));
        expectForbidden(mockMvc.perform(post("/api/review/pipeline/prepare-human-review")));
        expectForbidden(mockMvc.perform(post("/api/review/pipeline/llm-first-pass")));
    }

    @Test
    void reviewAdminEndpointsRejectWrongTokenInCloudMode() throws Exception {
        mockMvc.perform(
            postReviewTraining()
                .header(ReviewAdminGuard.ADMIN_TOKEN_HEADER, "wrong-token")
        )
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.message").value("Review admin operation is disabled on public deployment."));
    }

    @Test
    void reviewAdminEndpointAllowsCorrectTokenToReachBusinessValidation() throws Exception {
        mockMvc.perform(
            postReviewTraining()
                .header(ReviewAdminGuard.ADMIN_TOKEN_HEADER, "test-admin-token")
        )
            .andExpect((result) ->
                assertThat(result.getResponse().getStatus()).isNotEqualTo(403)
            );
    }

    @Test
    void systemInfoMarksReviewWritesAsAdminOnlyInCloudMode() throws Exception {
        mockMvc
            .perform(get("/api/system/info"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.deploymentMode").value("cloud"))
            .andExpect(jsonPath("$.reviewAccess.readable").value(true))
            .andExpect(jsonPath("$.reviewAccess.writeMode").value("admin_token_required"))
            .andExpect(jsonPath("$.reviewAccess.publicWriteEnabled").value(false));
    }

    private void expectForbidden(ResultActions action) throws Exception {
        action
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.message").value("Review admin operation is disabled on public deployment."));
    }

    private MockHttpServletRequestBuilder patchReviewDecision() {
        return patch("/api/review")
            .contentType(APPLICATION_JSON)
            .content(
                """
                {
                  "kind": "sft",
                  "reviewId": "missing-review",
                  "decision": "include",
                  "reviewer": "guard-test",
                  "notes": ""
                }
                """
            );
    }

    private MockHttpServletRequestBuilder postReviewTraining() {
        return post("/api/review/training")
            .contentType(APPLICATION_JSON)
            .content(
                """
                {
                  "kind": "sft"
                }
                """
            );
    }

    private MockHttpServletRequestBuilder postReviewTrainingEvaluation() {
        return post("/api/review/training/evaluate")
            .contentType(APPLICATION_JSON)
            .content(
                """
                {
                  "runId": "missing-run",
                  "bindingKey": "default"
                }
                """
            );
    }

    private MockHttpServletRequestBuilder postReviewTrainingDecision() {
        return post("/api/review/training/decision")
            .contentType(APPLICATION_JSON)
            .content(
                """
                {
                  "runId": "missing-run",
                  "decision": "accepted",
                  "reviewer": "guard-test",
                  "notes": ""
                }
                """
            );
    }

    private MockHttpServletRequestBuilder postReviewTrainingPromote() {
        return post("/api/review/training/promote")
            .contentType(APPLICATION_JSON)
            .content(
                """
                {
                  "runId": "missing-run",
                  "bindingKey": "default"
                }
                """
            );
    }
}
