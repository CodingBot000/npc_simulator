package com.npcsimulator.api.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.npcsimulator.analytics.VisitorAnalyticsHeaderResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest(properties = {
    "NPC_SIMULATOR_OWNER_TOKEN=test-owner-token"
})
class VisitorAnalyticsIntegrationTests {

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        this.mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
        jdbcTemplate.update("DELETE FROM npc_visitor_event");
        jdbcTemplate.update("DELETE FROM npc_visitor_owner");
    }

    @Test
    void visitorEventRecordsNonOwnerByDefault() throws Exception {
        mockMvc.perform(
                post("/api/visitor/events")
                    .header(VisitorAnalyticsHeaderResolver.VISITOR_ID_HEADER, "visitor_public_test")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "eventType": "page_view",
                          "worldInstanceId": "browser_public_test",
                          "metadata": {
                            "path": "/"
                          }
                        }
                        """
                    )
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.owner").value(false))
            .andExpect(jsonPath("$.eventType").value("page_view"));

        Boolean owner = jdbcTemplate.queryForObject(
            "SELECT is_owner FROM npc_visitor_event WHERE visitor_id = ?",
            Boolean.class,
            "visitor_public_test"
        );
        assertThat(owner).isFalse();
    }

    @Test
    void ownerSetupMarksLaterEventsAsOwner() throws Exception {
        mockMvc.perform(
                post("/api/visitor/owner")
                    .header(VisitorAnalyticsHeaderResolver.VISITOR_ID_HEADER, "visitor_owner_test")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "token": "test-owner-token"
                        }
                        """
                    )
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.owner").value(true));

        mockMvc.perform(
                post("/api/visitor/events")
                    .header(VisitorAnalyticsHeaderResolver.VISITOR_ID_HEADER, "visitor_owner_test")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "eventType": "interact_clicked",
                          "worldInstanceId": "browser_owner_test"
                        }
                        """
                    )
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.owner").value(true));

        Integer ownerEventCount = jdbcTemplate.queryForObject(
            """
            SELECT COUNT(*)
              FROM npc_visitor_event
             WHERE visitor_id = ?
               AND is_owner = TRUE
            """,
            Integer.class,
            "visitor_owner_test"
        );
        assertThat(ownerEventCount).isEqualTo(2);
    }

    @Test
    void ownerSetupRejectsWrongToken() throws Exception {
        mockMvc.perform(
                post("/api/visitor/owner")
                    .header(VisitorAnalyticsHeaderResolver.VISITOR_ID_HEADER, "visitor_wrong_token")
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "token": "wrong-token"
                        }
                        """
                    )
            )
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.message").value("Owner token is invalid or not configured."));
    }
}
