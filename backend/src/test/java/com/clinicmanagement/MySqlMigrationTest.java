package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("mysql")
class MySqlMigrationTest {
    @Test
    void migrateThroughV5ValidateAndRepeatWithoutChangingAppliedHistory() throws Exception {
        Flyway flyway = MySqlTestDatabase.flyway();
        int pendingBefore = flyway.info().pending().length;
        var result = flyway.migrate();
        assertThat(result.migrationsExecuted).isEqualTo(pendingBefore);
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(flyway.info().applied()).hasSize(5);
        assertThat(Arrays.stream(flyway.info().applied())
                .filter(info -> info.getVersion().getVersion().equals("1"))
                .map(info -> info.getScript()).toList()).containsExactly("V1__create_users.sql");
        assertThat(Arrays.stream(flyway.info().applied())
                .filter(info -> info.getVersion().getVersion().equals("2"))
                .map(info -> info.getScript()).toList()).containsExactly("V2__create_specialties_and_doctors.sql");
        assertThat(Arrays.stream(flyway.info().applied())
                .filter(info -> info.getVersion().getVersion().equals("3"))
                .map(info -> info.getScript()).toList()).containsExactly("V3__create_patients_and_profile_fields.sql");
        assertThat(Arrays.stream(flyway.info().applied())
                .filter(info -> info.getVersion().getVersion().equals("4"))
                .map(info -> info.getScript()).toList()).containsExactly("V4__add_profile_contact_fields_to_users.sql");
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("5");
        assertThat(flyway.info().current().getScript()).isEqualTo("V5__create_doctor_schedules.sql");
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
