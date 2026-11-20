package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.util.ArrayList;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("mysql")
class MySqlMigrationTest {
    @Test
    void migrateV1ValidateAndRepeatWithoutChangingAppliedHistory() throws Exception {
        Flyway flyway = MySqlTestDatabase.flyway();
        boolean fresh = flyway.info().current() == null;
        var result = flyway.migrate();
        assertThat(result.migrationsExecuted).isEqualTo(fresh ? 1 : 0);
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(flyway.info().applied()).hasSize(1);
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("1");
        assertThat(flyway.info().current().getScript()).isEqualTo("V1__create_users.sql");
        List<String> before = history(flyway);
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        assertThat(history(flyway)).isEqualTo(before);
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
    }

    private List<String> history(Flyway flyway) throws Exception {
        List<String> rows = new ArrayList<>();
        try (Connection connection = flyway.getConfiguration().getDataSource().getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT installed_rank, version, script, checksum, success, installed_on "
                     + "FROM flyway_schema_history ORDER BY installed_rank")) {
            while (result.next()) {
                rows.add(result.getInt(1) + ":" + result.getString(2) + ":" + result.getString(3) + ":"
                        + result.getInt(4) + ":" + result.getBoolean(5) + ":" + result.getString(6));
            }
        }
        return rows;
    }
}
