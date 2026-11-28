package com.clinicmanagement;

import org.flywaydb.core.Flyway;
import org.springframework.test.context.DynamicPropertyRegistry;

/** All write-capable MySQL tests must target a disposable, explicitly named local database. */
final class MySqlTestDatabase {
    private MySqlTestDatabase() {
    }

    static void requireIsolatedUrl(String url) {
        if (url == null || !url.matches("jdbc:mysql://(?:127\\.0\\.0\\.1|localhost):[0-9]+/clinic_d02_be_it_[a-z0-9_]+(?:\\?.*)?")) {
            throw new IllegalStateException("mysqlTest requires a loopback database named clinic_d02_be_it_*.");
        }
    }

    static void properties(DynamicPropertyRegistry registry) {
        requireIsolatedUrl(environment("DB_URL"));
        registry.add("spring.flyway.locations", MySqlTestDatabase::migrationLocation);
        registry.add("clinic.security.rate-limit.enabled", () -> "false");
    }

    static Flyway flyway() {
        String url = environment("DB_URL");
        requireIsolatedUrl(url);
        return Flyway.configure().dataSource(url, environment("DB_USERNAME"), environment("DB_PASSWORD"))
                .locations(migrationLocation()).cleanDisabled(true).baselineOnMigrate(false).load();
    }

    private static String migrationLocation() {
        String configured = System.getenv("MYSQL_TEST_MIGRATIONS_LOCATION");
        return configured == null || configured.isBlank() ? "classpath:db/migration" : configured;
    }

    private static String environment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required for isolated MySQL integration tests.");
        }
        return value;
    }
}
