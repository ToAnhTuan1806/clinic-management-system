package com.clinicmanagement;

import org.junit.jupiter.api.Tag;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@Tag("mysql")
@ActiveProfiles("mysql-integration")
class MySqlDoctorScheduleIntegrationTest extends DoctorScheduleHttpTestSupport {
    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        MySqlTestDatabase.properties(registry);
    }
}
