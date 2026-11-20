package com.clinicmanagement;

import java.security.SecureRandom;
import java.util.Base64;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

abstract class TestSecurityProperties {
    private static final String KEY = randomKey();
    static final String TEST_ORIGIN = "http://localhost:5173";

    @DynamicPropertySource
    static void securityProperties(DynamicPropertyRegistry registry) {
        registry.add("clinic.security.jwt.secret-base64", () -> KEY);
        registry.add("clinic.security.cors.allowed-origins", () -> TEST_ORIGIN);
    }

    private static String randomKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }
}
