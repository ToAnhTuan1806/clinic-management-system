package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.clinicmanagement.entity.AuthProvider;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.exception.AuthApiException;
import com.clinicmanagement.repository.PatientRepository;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.GoogleIdTokenVerifier;
import com.clinicmanagement.security.GoogleUserClaims;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.SecureRandom;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class GoogleAuthIntegrationTest {
    @LocalServerPort
    private int port;

    @Autowired
    private UserRepository users;

    @Autowired
    private PatientRepository patients;

    @Autowired
    private PasswordEncoder passwords;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private GoogleIdTokenVerifier googleVerifier;

    private final HttpClient http = HttpClient.newHttpClient();

    @DynamicPropertySource
    static void registerDynamicJwtSecret(DynamicPropertyRegistry registry) {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        registry.add("clinic.security.jwt.secret-base64", () -> Base64.getEncoder().encodeToString(key));
    }

    @BeforeEach
    void cleanDatabase() {
        jdbc.execute("DELETE FROM audit_logs");
        jdbc.execute("DELETE FROM patients");
        jdbc.execute("DELETE FROM users");
    }

    @Test
    void newGoogleUserCreatesPatientAndLinkedProfileAndCanAccessProtectedEndpoints() throws Exception {
        when(googleVerifier.verify("valid-google-token"))
                .thenReturn(new GoogleUserClaims("google-sub-1001", "patient.google@example.com", "Nguyễn Minh Anh", true));

        HttpResponse<String> response = postGoogle("valid-google-token");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");

        JsonNode root = objectMapper.readTree(response.body()).path("data");
        String accessToken = root.path("accessToken").asString();
        assertThat(accessToken).isNotBlank();
        assertThat(root.path("user").path("role").asString()).isEqualTo("PATIENT");
        assertThat(root.path("user").path("email").asString()).isEqualTo("patient.google@example.com");

        User saved = users.findByGoogleSub("google-sub-1001").orElseThrow();
        assertThat(saved.getAuthProvider()).isEqualTo(AuthProvider.GOOGLE);
        assertThat(saved.getRole()).isEqualTo(Role.PATIENT);
        assertThat(patients.existsByUserId(saved.getId())).isTrue();

        // Issued token works on /api/v1/me/patient-profile
        HttpRequest profileReq = HttpRequest.newBuilder(uri("/api/v1/me/patient-profile"))
                .header("Authorization", "Bearer " + accessToken)
                .GET().build();
        HttpResponse<String> profileResp = http.send(profileReq, HttpResponse.BodyHandlers.ofString());
        assertThat(profileResp.statusCode()).isEqualTo(200);
        assertThat(profileResp.body()).contains("PT-G-" + saved.getId());

        // Second sign-in reuses existing user and does not duplicate
        HttpResponse<String> second = postGoogle("valid-google-token");
        assertThat(second.statusCode()).isEqualTo(200);
        assertThat(users.count()).isEqualTo(1);
        assertThat(patients.count()).isEqualTo(1);
    }

    @Test
    void staffAccountsCannotSignInWithGoogle() throws Exception {
        User admin = User.registerPatient("admin@example.com", passwords.encode("StrongPassword123!"), "Clinic Admin");
        User saved = users.saveAndFlush(admin);
        jdbc.update("UPDATE users SET role = 'ADMIN' WHERE id = ?", saved.getId());

        when(googleVerifier.verify("staff-google-token"))
                .thenReturn(new GoogleUserClaims("google-sub-staff", "admin@example.com", "Clinic Admin", true));

        HttpResponse<String> response = postGoogle("staff-google-token");
        assertThat(response.statusCode()).isEqualTo(403);
        assertThat(response.body()).contains("\"code\":\"GOOGLE_LOGIN_NOT_ALLOWED\"");
    }

    @Test
    void invalidGoogleTokenReturnsUnauthorized() throws Exception {
        when(googleVerifier.verify("bad-token"))
                .thenThrow(new AuthApiException(HttpStatus.UNAUTHORIZED, "INVALID_GOOGLE_TOKEN",
                        "Invalid or expired Google credential."));

        HttpResponse<String> response = postGoogle("bad-token");
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(response.body()).contains("\"code\":\"INVALID_GOOGLE_TOKEN\"");
    }

    @Test
    void blankIdTokenReturnsBadRequest() throws Exception {
        HttpResponse<String> response = postGoogle("   ");
        assertThat(response.statusCode()).isEqualTo(400);
    }

    private HttpResponse<String> postGoogle(String idToken) throws Exception {
        String body = "{\"idToken\":\"" + idToken + "\"}";
        HttpRequest request = HttpRequest.newBuilder(uri("/api/v1/auth/google"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }
}
