package com.clinicmanagement.config;

import org.flywaydb.core.Flyway;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/** Validates a QA database without applying migrations or creating Flyway history. */
@Configuration
@Profile("mysql-validation")
public class MySqlValidationConfig {
    @Bean
    FlywayMigrationStrategy validateOnlyMigrationStrategy() {
        return Flyway::validate;
    }
}
