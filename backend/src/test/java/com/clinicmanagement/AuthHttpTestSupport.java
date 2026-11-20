package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.clinicmanagement.dto.LoginRequest;
import com.clinicmanagement.dto.LoginResponse;
import com.clinicmanagement.dto.RegisterRequest;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.security.ActiveUserJwtConverter;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(AuthHttpTestSupport.RoleFixtureConfiguration.class)
@ExtendWith(OutputCaptureExtension.class)
abstract class AuthHttpTestSupport extends TestSecurityProperties {
    @LocalServerPort
    private int port;
    @Autowired
    private ObjectMapper mapper;
    @Autowired
    private UserRepository users;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private PasswordEncoder passwords;
    @Autowired
    private JwtEncoder encoder;
    @Autowired
    private JwtDecoder decoder;
    @Autowired
    private ActiveUserJwtConverter converter;
    @Autowired
    private RoleProbe roleProbe;
    @Autowired
    private DataSource dataSource;

    private String email;
    private String password;
    private final List<String> sensitive = new ArrayList<>();

    @BeforeEach
    void prepare() throws Exception {
        try (var connection = dataSource.getConnection()) {
            if (!"H2".equals(connection.getMetaData().getDatabaseProductName())) {
                MySqlTestDatabase.requireIsolatedUrl(connection.getMetaData().getURL());
            }
        }
        users.deleteAll();
        email = UUID.randomUUID() + "@example.invalid";
        password = UUID.randomUUID().toString();
        sensitive.clear();
        sensitive.add(password);
    }

    @AfterEach
    void noCredentialsInLogs(CapturedOutput output) {
        for (String value : sensitive) {
            assertThat(output.getAll().contains(value)).as("sensitive value must not be logged").isFalse();
        }
        SecurityContextHolder.clearContext();
    }

    @Test
    void registerNormalizesEmailAndPersistsOnlyPatientWithBcrypt() throws Exception {
        var response = request("POST", "/api/v1/auth/register", registration("  " + email.toUpperCase() + "  "), null);
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.headers().firstValue("Location")).contains("/api/v1/auth/me");
        assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
        JsonNode data = body(response).path("data");
        assertUser(data, Role.PATIENT);
        assertThat(data.path("id").asString()).matches("[1-9][0-9]*");
        assertThat(data.path("email").asString()).isEqualTo(email);
        assertThat(data.path("fullName").asString()).isEqualTo("Synthetic Auth User");
        User saved = users.findByEmail(email).orElseThrow();
        sensitive.add(saved.getPasswordHash());
        assertThat(passwords.matches(password, saved.getPasswordHash())).isTrue();
        assertThat(saved.getPasswordHash().startsWith("$2")).isTrue();
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isNotNull();
        assertThat(saved.getLastLoginAt()).isNull();
        assertThat(mapper.writeValueAsString(saved).contains(saved.getPasswordHash())).isFalse();
    }

    @Test
    void duplicateEmailIsConflictAfterNormalization() throws Exception {
        register();
        var response = request("POST", "/api/v1/auth/register", registration(" " + email.toUpperCase() + " "), null);
        assertProblem(response, 409, "EMAIL_ALREADY_EXISTS");
        assertThat(users.count()).isEqualTo(1);
    }

    @ParameterizedTest(name = "invalid registration: {0}")
    @ValueSource(strings = {"email", "blankEmail", "blankName", "longName", "shortPassword", "blankPassword",
            "longPassword", "utf8Password", "missingEmail", "missingPassword", "missingName"})
    void invalidRegistrationIsRejected(String variant) throws Exception {
        Map<String, Object> payload = registration(email);
        switch (variant) {
            case "email" -> payload.put("email", UUID.randomUUID().toString());
            case "blankEmail" -> payload.put("email", " ");
            case "blankName" -> payload.put("fullName", " ");
            case "longName" -> payload.put("fullName", "x".repeat(121));
            case "shortPassword" -> payload.put("password", UUID.randomUUID().toString().substring(0, 8));
            case "blankPassword" -> payload.put("password", " ".repeat(12));
            case "longPassword" -> payload.put("password", UUID.randomUUID().toString().repeat(3));
            case "utf8Password" -> payload.put("password", "\u00e9".repeat(37));
            case "missingEmail" -> payload.remove("email");
            case "missingPassword" -> payload.remove("password");
            case "missingName" -> payload.remove("fullName");
            default -> throw new IllegalArgumentException();
        }
        assertProblem(request("POST", "/api/v1/auth/register", payload, null), 400, "VALIDATION_FAILED");
        assertThat(users.count()).isZero();
    }

    @ParameterizedTest(name = "reject mass assignment: {0}")
    @ValueSource(strings = {"role", "status", "id", "passwordHash"})
    void cannotSupplyPrivilegedFields(String field) throws Exception {
        Map<String, Object> payload = registration(email);
        payload.put(field, "role".equals(field) ? "ADMIN" : "DISABLED");
        assertProblem(request("POST", "/api/v1/auth/register", payload, null), 400, "HTTP_400");
        assertThat(users.count()).isZero();
    }

    @Test
    void loginAndMeUseBearerWithThirtyMinuteLifetimeAndNoSecrets() throws Exception {
        register();
        var response = request("POST", "/api/v1/auth/login", Map.of("email", " " + email.toUpperCase() + " ",
                "password", password), null);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Set-Cookie")).isEmpty();
        JsonNode data = body(response).path("data");
        assertThat(data.path("tokenType").asString()).isEqualTo("Bearer");
        assertThat(data.path("expiresIn").asLong()).isEqualTo(1800);
        assertUser(data.path("user"), Role.PATIENT);
        String token = rememberToken(data.path("accessToken").asString());
        var decoded = decoder.decode(token);
        assertThat(decoded.getHeaders().get("alg")).isEqualTo("HS256");
        assertThat(decoded.getExpiresAt().getEpochSecond() - decoded.getIssuedAt().getEpochSecond()).isEqualTo(1800);
        assertThat(decoded.getClaimAsString("iss")).isEqualTo("clinic-management");
        assertThat(users.findByEmail(email).orElseThrow().getLastLoginAt()).isNotNull();
        var me = request("GET", "/api/v1/auth/me", null, token);
        assertThat(me.statusCode()).isEqualTo(200);
        assertThat(me.headers().firstValue("Cache-Control")).contains("no-store");
        assertUser(body(me).path("data"), Role.PATIENT);
        assertThat(new RegisterRequest(email, password, "Synthetic Auth User").toString().contains(password)).isFalse();
        assertThat(new LoginRequest(email, password).toString().contains(password)).isFalse();
        assertThat(new LoginResponse(token, "Bearer", 1800, null).toString().contains(token)).isFalse();
    }

    @ParameterizedTest(name = "generic login failure: {0}")
    @ValueSource(strings = {"wrongPassword", "unknownUser", "disabled"})
    void loginFailuresDoNotRevealAccountState(String variant) throws Exception {
        register();
        if (variant.equals("disabled")) {
            jdbc.update("UPDATE users SET status = 'DISABLED' WHERE email = ?", email);
        }
        String suppliedEmail = variant.equals("unknownUser") ? UUID.randomUUID() + "@example.invalid" : email;
        String suppliedPassword = variant.equals("wrongPassword") ? UUID.randomUUID().toString() : password;
        sensitive.add(suppliedPassword);
        var response = request("POST", "/api/v1/auth/login",
                Map.of("email", suppliedEmail, "password", suppliedPassword), null);
        assertProblem(response, 401, "INVALID_CREDENTIALS");
        assertThat(body(response).path("detail").asString()).isEqualTo("Invalid email or password.");
        assertThat(users.findByEmail(email).orElseThrow().getLastLoginAt()).isNull();
    }

    @ParameterizedTest(name = "invalid JWT claims: {0}")
    @ValueSource(strings = {"expired", "issuer", "missingExpiry", "missingSubject", "futureIssued", "longLifetime"})
    void invalidJwtClaimsReturn401(String variant) throws Exception {
        register();
        String id = users.findByEmail(email).orElseThrow().getId().toString();
        Instant now = Instant.now().minusSeconds(1);
        var claims = JwtClaimsSet.builder().issuer("clinic-management").subject(id)
                .issuedAt(now).expiresAt(now.plusSeconds(1800));
        switch (variant) {
            case "expired" -> claims.issuedAt(now.minusSeconds(3600)).expiresAt(now.minusSeconds(1800));
            case "issuer" -> claims.issuer("untrusted-test-issuer");
            case "missingExpiry" -> claims.claims(values -> values.remove("exp"));
            case "missingSubject" -> claims.claims(values -> values.remove("sub"));
            case "futureIssued" -> claims.issuedAt(now.plusSeconds(300)).expiresAt(now.plusSeconds(1800));
            case "longLifetime" -> claims.expiresAt(now.plusSeconds(3600));
            default -> throw new IllegalArgumentException();
        }
        String token = rememberToken(encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(), claims.build())).getTokenValue());
        assertProblem(request("GET", "/api/v1/auth/me", null, token), 401, "INVALID_ACCESS_TOKEN");
    }

    @ParameterizedTest(name = "invalidate existing JWT after: {0}")
    @ValueSource(strings = {"disable", "delete"})
    void currentDatabaseAccountStateIsCheckedOnEveryRequest(String action) throws Exception {
        register();
        String token = loginToken();
        if (action.equals("disable")) {
            jdbc.update("UPDATE users SET status = 'DISABLED' WHERE email = ?", email);
        } else {
            users.deleteAll();
        }
        assertProblem(request("GET", "/api/v1/auth/me", null, token), 401, "INVALID_ACCESS_TOKEN");
    }

    @Test
    void wrongSignatureReturns401OverHttp() throws Exception {
        register();
        String token = loginToken();
        int signatureStart = token.lastIndexOf('.') + 1;
        char replacement = token.charAt(signatureStart) == 'A' ? 'B' : 'A';
        String tampered = rememberToken(token.substring(0, signatureStart) + replacement
                + token.substring(signatureStart + 1));
        assertProblem(request("GET", "/api/v1/auth/me", null, tampered), 401, "INVALID_ACCESS_TOKEN");
    }

    @Test
    void tokenRoleClaimsCannotGrantAdministratorAuthority() throws Exception {
        register();
        Instant now = Instant.now().minusSeconds(1);
        var claims = JwtClaimsSet.builder().issuer("clinic-management")
                .subject(users.findByEmail(email).orElseThrow().getId().toString())
                .issuedAt(now).expiresAt(now.plusSeconds(1800))
                .claim("role", "ADMIN").claim("roles", List.of("ADMIN")).claim("scope", "ADMIN").build();
        String token = rememberToken(encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(), claims)).getTokenValue());
        var response = request("GET", "/api/v1/auth/me", null, token);
        assertThat(response.statusCode()).isEqualTo(200);
        assertUser(body(response).path("data"), Role.PATIENT);
        assertThat(converter.convert(decoder.decode(token)).getAuthorities().stream().map(Object::toString).toList())
                .containsExactly("ROLE_PATIENT");
    }

    @ParameterizedTest
    @EnumSource(Role.class)
    void rolesComeFromDatabaseAndUnimplementedApisStayDenied(Role role) throws Exception {
        register();
        String token = loginToken();
        jdbc.update("UPDATE users SET role = ? WHERE email = ?", role.name(), email);
        var me = request("GET", "/api/v1/auth/me", null, token);
        assertThat(me.statusCode()).isEqualTo(200);
        assertUser(body(me).path("data"), role);
        var authentication = converter.convert(decoder.decode(token));
        assertThat(authentication.getAuthorities().stream().map(Object::toString).toList())
                .containsExactly("ROLE_" + role.name());
        SecurityContextHolder.getContext().setAuthentication(authentication);
        if (role == Role.ADMIN) {
            assertThat(roleProbe.adminOnly()).isTrue();
        } else {
            assertThrows(AccessDeniedException.class, roleProbe::adminOnly);
        }
        assertProblem(request("GET", "/api/v1/users", null, token), 403, "ACCESS_DENIED");
        assertProblem(request("POST", "/api/v1/appointments", Map.of(), token), 403, "ACCESS_DENIED");
    }

    @Test
    void missingMalformedAndCookieOrQueryTokensCannotAuthenticate() throws Exception {
        register();
        assertProblem(request("GET", "/api/v1/auth/me", null, null), 401, "AUTHENTICATION_REQUIRED");
        assertProblem(request("GET", "/api/v1/auth/me", null, UUID.randomUUID().toString()), 401, "INVALID_ACCESS_TOKEN");
        String token = loginToken();
        assertProblem(request("GET", "/api/v1/auth/me?access_token=" + token, null, null), 401, "AUTHENTICATION_REQUIRED");
        var cookie = request("GET", "/api/v1/auth/me", null, null, Map.of("Cookie", "access_token=" + token));
        assertProblem(cookie, 401, "AUTHENTICATION_REQUIRED");
        assertThat(body(cookie).path("instance").asString()).isEqualTo("/api/v1/auth/me");
    }

    @Test
    void logoutHasNoServerRevokeEndpoint() throws Exception {
        register();
        String token = loginToken();
        assertProblem(request("POST", "/api/v1/auth/logout", Map.of(), token), 403, "ACCESS_DENIED");
        assertThat(request("GET", "/api/v1/auth/me", null, token).statusCode()).isEqualTo(200);
    }

    @Test
    void corsAllowsOnlyConfiguredOriginAndHeadersWithoutCookies() throws Exception {
        var allowed = request("OPTIONS", "/api/v1/auth/login", null, null,
                Map.of("Origin", TEST_ORIGIN, "Access-Control-Request-Method", "POST",
                        "Access-Control-Request-Headers", "authorization,content-type"));
        assertThat(allowed.statusCode()).isEqualTo(200);
        assertThat(allowed.headers().firstValue("Access-Control-Allow-Origin")).contains(TEST_ORIGIN);
        assertThat(allowed.headers().firstValue("Access-Control-Allow-Credentials")).isEmpty();
        var denied = request("OPTIONS", "/api/v1/auth/login", null, null,
                Map.of("Origin", "https://untrusted.example.invalid", "Access-Control-Request-Method", "POST"));
        assertProblem(denied, 403, "CORS_REJECTED");
        var disallowedHeader = request("OPTIONS", "/api/v1/auth/login", null, null,
                Map.of("Origin", TEST_ORIGIN, "Access-Control-Request-Method", "POST",
                        "Access-Control-Request-Headers", "x-unapproved-header"));
        assertProblem(disallowedHeader, 403, "CORS_REJECTED");
        var actual = request("POST", "/api/v1/auth/register", registration(email), null, Map.of("Origin", TEST_ORIGIN));
        assertThat(actual.statusCode()).isEqualTo(201);
        assertThat(actual.headers().firstValue("Access-Control-Allow-Origin")).contains(TEST_ORIGIN);
        assertThat(actual.headers().firstValue("Access-Control-Expose-Headers")).contains("Location");
    }

    @Test
    void concurrentRegistrationProducesOneAccountAndOneConflict() throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> { start.await(); return request("POST", "/api/v1/auth/register", registration(email), null); });
            var second = executor.submit(() -> { start.await(); return request("POST", "/api/v1/auth/register", registration(email), null); });
            start.countDown();
            assertThat(List.of(first.get().statusCode(), second.get().statusCode())).containsExactlyInAnyOrder(201, 409);
        }
        assertThat(users.count()).isEqualTo(1);
    }

    private Map<String, Object> registration(String suppliedEmail) {
        return new HashMap<>(Map.of("email", suppliedEmail, "password", password, "fullName", " Synthetic Auth User "));
    }

    private void register() throws Exception {
        assertThat(request("POST", "/api/v1/auth/register", registration(email), null).statusCode()).isEqualTo(201);
    }

    private String loginToken() throws Exception {
        var response = request("POST", "/api/v1/auth/login", Map.of("email", email, "password", password), null);
        assertThat(response.statusCode()).isEqualTo(200);
        return rememberToken(body(response).path("data").path("accessToken").asString());
    }

    private String rememberToken(String token) {
        sensitive.add(token);
        return token;
    }

    private JsonNode body(HttpResponse<String> response) {
        return mapper.readTree(response.body());
    }

    private void assertUser(JsonNode data, Role role) {
        assertThat(data.path("role").asString()).isEqualTo(role.name());
        assertThat(data.path("status").asString()).isEqualTo("ACTIVE");
        assertThat(data.size()).isEqualTo(5);
        for (String field : List.of("id", "email", "fullName", "role", "status")) {
            assertThat(data.has(field)).as("public user field: " + field).isTrue();
        }
    }

    private void assertProblem(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/problem+json");
        JsonNode problem = body(response);
        assertThat(problem.path("status").asInt()).isEqualTo(status);
        assertThat(problem.path("code").asString()).isEqualTo(code);
        assertThat(problem.path("passwordHash").isMissingNode()).isTrue();
        assertThat(response.body().contains(password)).isFalse();
        if (status == 401 && code.contains("TOKEN")) {
            assertThat(response.headers().firstValue("WWW-Authenticate")).contains("Bearer");
        }
    }

    private HttpResponse<String> request(String method, String path, Object payload, String token) throws Exception {
        return request(method, path, payload, token, Map.of());
    }

    private HttpResponse<String> request(String method, String path, Object payload, String token,
                                         Map<String, String> headers) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        if (payload != null) {
            builder.header("Content-Type", "application/json");
        }
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
        }
        headers.forEach(builder::header);
        builder.method(method, payload == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)));
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    @TestConfiguration
    static class RoleFixtureConfiguration {
        @Bean
        RoleProbe roleProbe() { return new RoleProbe(); }
    }

    static class RoleProbe {
        @PreAuthorize("hasRole('ADMIN')")
        public boolean adminOnly() { return true; }
    }
}
