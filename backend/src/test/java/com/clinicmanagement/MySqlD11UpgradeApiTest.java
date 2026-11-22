package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import com.clinicmanagement.repository.UserRepository;
import com.clinicmanagement.service.JwtTokenService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Tag("mysql")
@ActiveProfiles("mysql-integration")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(MySqlD11UpgradeApiTest.LegacyDataBeforeV10.class)
class MySqlD11UpgradeApiTest extends TestSecurityProperties {
    @LocalServerPort private int port;
    @Autowired private JwtTokenService tokens;
    @Autowired private UserRepository users;
    @Autowired private ObjectMapper mapper;
    @Autowired private Flyway flyway;
    @Autowired private JdbcTemplate jdbc;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String url = System.getenv("D11_API_UPGRADE_URL");
        MySqlTestDatabase.requireIsolatedUrl(url);
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.flyway.target", () -> "10");
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class LegacyDataBeforeV10 {
        @Bean
        FlywayMigrationStrategy seedD10ThenApplyRealV10() {
            return migration -> {
                try (var connection = migration.getConfiguration().getDataSource().getConnection()) {
                    MySqlTestDatabase.requireIsolatedUrl(connection.getMetaData().getURL());
                } catch (java.sql.SQLException exception) {
                    throw new IllegalStateException("Cannot verify isolated upgrade database.");
                }
                var old = Flyway.configure().configuration(migration.getConfiguration()).target("9").load();
                assertThat(old.migrate().migrationsExecuted).isEqualTo(9);
                // Data only: table definitions and backfill both come from the real QA migrations.
                MedicalHistorySchemaTest.seed(new JdbcTemplate(old.getConfiguration().getDataSource()));
                assertThat(migration.migrate().migrationsExecuted).isOne();
            };
        }
    }

    @Test
    void backfilledD10RecordsAreVisibleButNewCompletionsNeedRelease() throws Exception {
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(flyway.info().applied()).hasSize(10);
        String patient = token(3L);
        String doctor = token(2L);
        String otherDoctor = token(1L);
        String otherPatient = token(4L);
        var legacy = get("/api/v1/medical-records/1", patient, 200);
        assertThat(legacy.path("version").asLong()).isEqualTo(3);
        assertThat(legacy.path("releasedAt")).isEqualTo(legacy.path("completedAt"));
        assertThat(legacy.path("releasedBy")).isEqualTo(legacy.path("completedBy"));
        assertThat(get("/api/v1/medical-records/by-appointment/1", patient, 200)).isEqualTo(legacy);
        get("/api/v1/medical-records/1", otherPatient, 404);
        get("/api/v1/medical-records/1", otherDoctor, 404);
        assertThat(get("/api/v1/medical-records/1", doctor, 200)).isEqualTo(legacy);
        var history = get("/api/v1/patients/1/medical-history?size=2", patient, 200);
        assertThat(history.path("totalElements").asInt()).isEqualTo(3);

        jdbc.update("""
                INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,
                  start_at_utc,end_at_utc,status,request_key,request_fingerprint,created_at,updated_at)
                SELECT 13,'NEW-D11',patient_id,doctor_id,schedule_id,created_by,
                  '2026-11-01 19:00:00','2026-11-01 19:30:00','COMPLETED','new-d11',
                  request_fingerprint,created_at,updated_at FROM appointments WHERE id=1
                """);
        jdbc.update("""
                INSERT INTO medical_records(id,appointment_id,symptoms,diagnosis,conclusion,
                  created_by,completed_at,completed_by,version,created_at,updated_at)
                SELECT 13,13,'Synthetic new symptoms','Synthetic diagnosis','Synthetic conclusion',
                  created_by,completed_at,completed_by,3,created_at,updated_at FROM medical_records WHERE id=1
                """);
        get("/api/v1/medical-records/13", patient, 404);
        get("/api/v1/medical-records/by-appointment/13", patient, 404);
        var fresh = get("/api/v1/medical-records/13", doctor, 200);
        assertThat(fresh.path("releasedAt").isNull()).isTrue();
        assertThat(get("/api/v1/patients/1/medical-history", patient, 200).path("totalElements").asInt()).isEqualTo(3);
        try (HttpClient client = HttpClient.newHttpClient()) {
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/medical-records/13/release"))
                    .header("Authorization", "Bearer " + doctor).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(Map.of("expectedVersion", 3)))).build();
            assertThat(client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);
        }
        assertThat(get("/api/v1/medical-records/13", patient, 200).path("version").asLong()).isEqualTo(4);
        assertThat(get("/api/v1/patients/1/medical-history", patient, 200).path("totalElements").asInt()).isEqualTo(4);
        assertThat(flyway.migrate().migrationsExecuted).isZero();
    }

    private String token(Long userId) {
        return tokens.issue(users.findById(userId).orElseThrow());
    }

    private JsonNode get(String path, String bearer, int expectedStatus) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                    .header("Authorization", "Bearer " + bearer).GET().build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(expectedStatus);
            assertThat(response.headers().firstValue("Cache-Control").orElse("")).contains("no-store");
            return mapper.readTree(response.body()).path("data");
        }
    }
}
