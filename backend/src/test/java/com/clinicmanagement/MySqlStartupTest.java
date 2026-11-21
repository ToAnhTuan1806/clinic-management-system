package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import javax.sql.DataSource;
import java.util.HashMap;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.core.env.Environment;
import tools.jackson.databind.ObjectMapper;

@Tag("mysql")
@ActiveProfiles("mysql-integration")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MySqlStartupTest extends TestSecurityProperties {
    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        MySqlTestDatabase.properties(registry);
    }

    @LocalServerPort
    private int port;
    @Autowired
    private DataSource dataSource;
    @Autowired
    private Flyway flyway;
    @Autowired
    private ObjectMapper mapper;
    @Autowired
    private Environment environment;

    @Test
    void startsWithRealMySqlAndValidatesMigrations() throws Exception {
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT 1")) {
            assertThat(connection.getMetaData().getDatabaseProductName()).isEqualTo("MySQL");
            assertThat(result.next()).isTrue();
            assertThat(result.getInt(1)).isEqualTo(1);
        }
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
    }

    @Test
    void healthWorksOverHttpWithMySqlContext() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            var response = client.send(HttpRequest.newBuilder(
                            URI.create("http://127.0.0.1:" + port + "/api/v1/health")).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(mapper.readTree(response.body()))
                    .isEqualTo(mapper.readTree("{\"data\":{\"status\":\"UP\"}}"));
        }
    }

    @Test
    void schemaMatchesUserEntityAndReviewedV1() throws Exception {
        Map<String, String> columns = new HashMap<>();
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT column_name, column_type, is_nullable, "
                     + "COALESCE(collation_name, ''), COALESCE(datetime_precision, 0) "
                     + "FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users'")) {
            while (result.next()) {
                columns.put(result.getString(1), result.getString(2) + ":" + result.getString(3)
                        + ":" + result.getString(4) + ":" + result.getInt(5));
            }
        }
        assertThat(columns).hasSize(11);
        assertThat(columns.get("id")).isEqualTo("bigint:NO::0");
        assertThat(columns.get("email")).isEqualTo("varchar(254):NO:utf8mb4_bin:0");
        assertThat(columns.get("password_hash")).startsWith("varchar(255):NO:");
        assertThat(columns.get("full_name")).startsWith("varchar(120):NO:");
        assertThat(columns.get("role")).isEqualTo("varchar(20):NO:utf8mb4_0900_bin:0");
        assertThat(columns.get("status")).isEqualTo("varchar(16):NO:utf8mb4_0900_bin:0");
        assertThat(columns.get("created_at")).isEqualTo("datetime(6):NO::6");
        assertThat(columns.get("updated_at")).isEqualTo("datetime(6):NO::6");
        assertThat(columns.get("last_login_at")).isEqualTo("datetime(6):YES::6");
        assertThat(columns.get("phone")).startsWith("varchar(24):YES:");
        assertThat(columns.get("address")).startsWith("varchar(255):YES:");
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT constraint_name, constraint_type "
                     + "FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'users'")) {
            Map<String, String> constraints = new HashMap<>();
            while (result.next()) {
                constraints.put(result.getString(1), result.getString(2));
            }
            assertThat(constraints).containsEntry("PRIMARY", "PRIMARY KEY").containsEntry("uk_users_email", "UNIQUE")
                    .containsEntry("chk_users_email_canonical", "CHECK").containsEntry("chk_users_role", "CHECK")
                    .containsEntry("chk_users_status", "CHECK").containsEntry("chk_users_phone", "CHECK")
                    .containsEntry("chk_users_address", "CHECK");
        }
    }

    @Test
    void hibernateOnlyValidatesAndDatabaseSessionsUseUtc() throws Exception {
        assertThat(environment.getProperty("spring.jpa.hibernate.ddl-auto")).isEqualTo("validate");
        assertThat(environment.getProperty("spring.jpa.properties.hibernate.jdbc.time_zone")).isEqualTo("UTC");
        assertThat(environment.getProperty("spring.sql.init.mode")).isEqualTo("never");
        assertThat(flyway.getConfiguration().isCleanDisabled()).isTrue();
        assertThat(flyway.getConfiguration().isBaselineOnMigrate()).isFalse();
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT @@session.time_zone")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString(1)).isIn("+00:00", "UTC");
        }
    }
}
