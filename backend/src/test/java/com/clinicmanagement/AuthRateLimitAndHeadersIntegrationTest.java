package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.SecureRandom;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "clinic.security.rate-limit.enabled=true",
        "clinic.security.rate-limit.login-max-requests=3",
        "clinic.security.rate-limit.register-max-requests=2",
        "clinic.security.rate-limit.window-seconds=60"
})
class AuthRateLimitAndHeadersIntegrationTest {
    @DynamicPropertySource
    static void registerDynamicJwtSecret(DynamicPropertyRegistry registry) {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        String encoded = Base64.getEncoder().encodeToString(key);
        registry.add("clinic.security.jwt.secret-base64", () -> encoded);
    }
    @LocalServerPort
    private int port;

    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void healthEndpointIncludesAllRequiredSecurityHeaders() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri("/api/v1/health")).GET().build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(200);
        assertSecurityHeaders(response);
    }

    @Test
    void loginEndpointEnforcesRateLimitAndReturnsProblemDetailsWithHeaders() throws Exception {
        String body = "{\"email\":\"missing@example.com\",\"password\":\"WrongPassword123!\"}";
        for (int i = 0; i < 3; i++) {
            HttpResponse<String> allowed = postJson("/api/v1/auth/login", body);
            assertThat(allowed.statusCode()).isEqualTo(401);
            assertSecurityHeaders(allowed);
        }

        HttpResponse<String> throttled = postJson("/api/v1/auth/login", body);
        assertThat(throttled.statusCode()).isEqualTo(429);
        assertThat(throttled.headers().firstValue("Retry-After")).isPresent();
        assertThat(Integer.parseInt(throttled.headers().firstValue("Retry-After").orElseThrow()))
                .isBetween(1, 60);
        assertThat(throttled.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(throttled.body()).contains("\"code\":\"RATE_LIMIT_EXCEEDED\"");
        assertSecurityHeaders(throttled);
    }

    @Test
    void registerEndpointEnforcesRateLimitAndReturnsProblemDetailsWithHeaders() throws Exception {
        String body = "{\"email\":\"invalid-email\",\"password\":\"short\",\"fullName\":\"\"}";
        for (int i = 0; i < 2; i++) {
            HttpResponse<String> allowed = postJson("/api/v1/auth/register", body);
            assertThat(allowed.statusCode()).isEqualTo(400);
            assertSecurityHeaders(allowed);
        }

        HttpResponse<String> throttled = postJson("/api/v1/auth/register", body);
        assertThat(throttled.statusCode()).isEqualTo(429);
        assertThat(throttled.headers().firstValue("Retry-After")).isPresent();
        assertThat(throttled.body()).contains("\"code\":\"RATE_LIMIT_EXCEEDED\"");
        assertSecurityHeaders(throttled);
    }

    private HttpResponse<String> postJson(String path, String json) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private void assertSecurityHeaders(HttpResponse<?> response) {
        assertThat(response.headers().firstValue("Content-Security-Policy"))
                .contains("default-src 'none'; frame-ancestors 'none'");
        assertThat(response.headers().firstValue("X-Frame-Options")).contains("DENY");
        assertThat(response.headers().firstValue("X-Content-Type-Options")).contains("nosniff");
        assertThat(response.headers().firstValue("Referrer-Policy")).contains("no-referrer");
        assertThat(response.headers().firstValue("Permissions-Policy"))
                .contains("geolocation=(), microphone=(), camera=()");
    }
}
