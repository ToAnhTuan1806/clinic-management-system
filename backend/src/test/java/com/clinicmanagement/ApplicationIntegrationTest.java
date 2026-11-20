package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApplicationIntegrationTest {
    @LocalServerPort
    private int port;
    @Autowired
    private ObjectMapper mapper;
    @Autowired
    private Flyway flyway;
    @Autowired
    private WebApplicationContext context;

    @Test
    void healthIsPublicAndOnlyReportsLiveness() throws Exception {
        HttpResponse<String> response = send("GET", "/api/v1/health");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(mapper.readTree(response.body())).isEqualTo(mapper.valueToTree(
                Map.of("data", Map.of("status", "UP"))));
        assertThat(response.headers().firstValue("X-Content-Type-Options")).contains("nosniff");
        assertThat(response.headers().firstValue("Set-Cookie")).isEmpty();
    }

    @Test
    void anonymousRequestsCannotReachProposedOrUnknownEndpoints() throws Exception {
        for (String path : new String[]{"/api/v1/patients", "/api/v1/health/details", "/actuator/env", "/error"}) {
            HttpResponse<String> response = send("GET", path);
            assertThat(response.statusCode()).isEqualTo(401);
            assertProblem(response, "AUTHENTICATION_REQUIRED", path);
            assertThat(response.body()).doesNotContain("password", "jdbc:", "exception", "stackTrace");
        }
    }

    @Test
    void writesRemainCsrfProtectedAndLoginIsNotAvailable() throws Exception {
        HttpResponse<String> response = send("POST", "/api/v1/auth/login");
        assertThat(response.statusCode()).isEqualTo(403);
        assertProblem(response, "ACCESS_DENIED", "/api/v1/auth/login");
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void evenAuthenticatedUsersCannotAccessUnimplementedApis() throws Exception {
        MockMvc mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        mvc.perform(get("/api/v1/patients")).andExpect(status().isForbidden());
    }

    @Test
    void flywayStartsAndNoDomainMigrationIsInvented() {
        assertThat(flyway.getConfiguration().isCleanDisabled()).isTrue();
        assertThat(flyway.getConfiguration().isBaselineOnMigrate()).isFalse();
        assertThat(flyway.info().pending()).isEmpty();
        assertThat(flyway.info().applied()).isEmpty();
    }

    private void assertProblem(HttpResponse<String> response, String code, String path) throws Exception {
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/problem+json");
        JsonNode error = mapper.readTree(response.body());
        assertThat(error.path("status").asInt()).isEqualTo(response.statusCode());
        assertThat(error.path("type").asString()).isEqualTo("about:blank");
        assertThat(error.path("code").asString()).isEqualTo(code);
        assertThat(error.path("instance").asString()).isEqualTo(path);
    }

    private HttpResponse<String> send(String method, String path) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                            .method(method, HttpRequest.BodyPublishers.noBody()).build(),
                    HttpResponse.BodyHandlers.ofString());
        }
    }
}
