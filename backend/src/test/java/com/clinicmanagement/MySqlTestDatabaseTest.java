package com.clinicmanagement;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class MySqlTestDatabaseTest {
    @Test
    void refusesSharedRemoteOrUnidentifiedDatabasesBeforeAnyCleanup() {
        for (String url : new String[]{null, "jdbc:mysql://127.0.0.1:3307/clinic_management_db",
                "jdbc:mysql://remote.example.invalid:3307/clinic_d02_be_it_example",
                "jdbc:mysql://127.0.0.1:3307/another_project"}) {
            assertThrows(IllegalStateException.class, () -> MySqlTestDatabase.requireIsolatedUrl(url));
        }
    }

    @Test
    void acceptsExplicitDisposableLoopbackDatabaseOnly() {
        assertDoesNotThrow(() -> MySqlTestDatabase.requireIsolatedUrl(
                "jdbc:mysql://127.0.0.1:3307/clinic_d02_be_it_example?connectionTimeZone=UTC"));
        assertDoesNotThrow(() -> MySqlTestDatabase.requireIsolatedUrl(
                "jdbc:mysql://localhost:3307/clinic_d02_be_it_example"));
    }
}
