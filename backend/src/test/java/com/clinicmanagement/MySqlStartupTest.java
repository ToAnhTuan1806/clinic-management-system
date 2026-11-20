package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;

@Tag("mysql")
@ActiveProfiles("mysql-validation")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MySqlStartupTest extends TestSecurityProperties {
    @LocalServerPort
    private int port;
    @Autowired
    private DataSource dataSource;
    @Autowired
    private Flyway flyway;
    @Autowired
    private ObjectMapper mapper;

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
}
