package com.clinicmanagement;

import org.junit.jupiter.api.Tag;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@Tag("mysql")
@ActiveProfiles("mysql-integration")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MySqlAppointmentIntegrationTest extends AppointmentHttpTestSupport {
    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        MySqlTestDatabase.properties(registry);
    }
}
