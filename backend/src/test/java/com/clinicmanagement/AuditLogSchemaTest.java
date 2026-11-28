package com.clinicmanagement;

import static org.assertj.core.api.Assertions.*;

import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Tag("mysql")
class AuditLogSchemaTest {
    static Flyway flyway(String variable, String target) {
        String url = System.getenv(variable);
        MySqlTestDatabase.requireIsolatedUrl(url);
        return Flyway.configure()
                .dataSource(url, System.getenv("DB_USERNAME"), System.getenv("DB_PASSWORD"))
                .locations("classpath:db/migration")
                .target(target)
                .cleanDisabled(true)
                .baselineOnMigrate(false)
                .load();
    }

    static void insert(
            JdbcTemplate db,
            Long actorUserId,
            String actorRole,
            String action,
            String entityType,
            Long entityId,
            String result,
            String eventKey) {
        db.update("""
                INSERT INTO audit_logs(actor_user_id, actor_role, action, entity_type, entity_id, result, event_key, metadata, occurred_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, '{"appointmentCode":"APP000001"}', '2026-11-28 03:00:00.123456')
                """, actorUserId, actorRole, action, entityType, entityId, result, eventKey);
    }

    @Test
    void freshConstraintsDedupTransactionsAndIndexes() throws Exception {
        var f = flyway("D14_FRESH_URL", "13");
        assertThat(f.migrate().migrationsExecuted).isEqualTo(13);
        assertThat(f.validateWithResult().validationSuccessful).isTrue();
        var db = new JdbcTemplate(f.getConfiguration().getDataSource());
        PrescriptionSchemaTest.seed(db);

        // Valid insert + unique event_key protection
        insert(db, 50L, "RECEPTIONIST", "APPOINTMENT_CONFIRMED", "APPOINTMENT", 4L, "SUCCESS", "appointment:4:v1:CONFIRMED");
        reject(() -> insert(db, 50L, "RECEPTIONIST", "APPOINTMENT_CONFIRMED", "APPOINTMENT", 4L, "SUCCESS", "appointment:4:v1:CONFIRMED"), 1062);

        // Nullable event_key allows repeated non-idempotent events such as PROFILE_UPDATED
        insert(db, 50L, "PATIENT", "PROFILE_UPDATED", "USER", 50L, "SUCCESS", null);
        insert(db, 50L, "PATIENT", "PROFILE_UPDATED", "USER", 50L, "SUCCESS", null);

        // System event with null actor_user_id is allowed
        insert(db, null, "SYSTEM", "SYSTEM_CHECK", "USER", null, "SUCCESS", "system:check:1");

        // FK & CHECK constraints
        reject(() -> insert(db, 999999L, "ADMIN", "APPOINTMENT_BOOKED", "APPOINTMENT", 4L, "SUCCESS", "bad-actor"), 1452);
        reject(() -> insert(db, 50L, "INVALID_ROLE", "APPOINTMENT_BOOKED", "APPOINTMENT", 4L, "SUCCESS", "bad-role"), 3819);
        reject(() -> insert(db, 50L, "ADMIN", "APPOINTMENT_BOOKED", "APPOINTMENT", 4L, "INVALID", "bad-result"), 3819);
        reject(() -> insert(db, 50L, "ADMIN", " ", "APPOINTMENT", 4L, "SUCCESS", "bad-action"), 3819);
        reject(() -> insert(db, 50L, "ADMIN", "APPOINTMENT_BOOKED", " ", 4L, "SUCCESS", "bad-entity"), 3819);
        reject(() -> db.update("DELETE FROM users WHERE id=50"), 1451);
        reject(() -> db.update("UPDATE users SET id=51 WHERE id=50"), 1451);

        // Transaction rollback test
        var transaction = new TransactionTemplate(new DataSourceTransactionManager(db.getDataSource()));
        long countBefore = db.queryForObject("SELECT COUNT(*) FROM audit_logs", Long.class);
        reject(() -> transaction.executeWithoutResult(status -> {
            insert(db, 50L, "RECEPTIONIST", "APPOINTMENT_CHECKED_IN", "APPOINTMENT", 4L, "SUCCESS", "appointment:4:v2:CHECKED_IN");
            insert(db, 999999L, "RECEPTIONIST", "APPOINTMENT_NO_SHOW", "APPOINTMENT", 4L, "SUCCESS", "appointment:4:v3:NO_SHOW");
        }), 1452);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM audit_logs", Long.class)).isEqualTo(countBefore);

        // Concurrent duplicate event_key race
        var barrier = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            Callable<Boolean> race = () -> {
                barrier.await(10, TimeUnit.SECONDS);
                try {
                    insert(db, 50L, "DOCTOR", "MEDICAL_RECORD_COMPLETED", "MEDICAL_RECORD", 4L, "SUCCESS", "medical_record:4:v1:COMPLETED");
                    return true;
                } catch (org.springframework.dao.DuplicateKeyException expected) {
                    return false;
                }
            };
            var a = pool.submit(race);
            var b = pool.submit(race);
            assertThat(List.of(a.get(30, TimeUnit.SECONDS), b.get(30, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(true, false);
        }

        // Verify all expected indexes exist
        assertThat(db.queryForList(
                "SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='audit_logs'",
                String.class))
                .containsExactlyInAnyOrder(
                        "PRIMARY",
                        "uk_audit_logs_event_key",
                        "ix_audit_logs_occurred_id",
                        "ix_audit_logs_actor_occurred_id",
                        "ix_audit_logs_action_occurred_id",
                        "ix_audit_logs_entity");
        assertThat(f.migrate().migrationsExecuted).isZero();
    }

    @Test
    void upgradeV12ToV13PreservesDataAndDoesNotBackfill() {
        var old = flyway("D14_UPGRADE_URL", "12");
        assertThat(old.migrate().migrationsExecuted).isEqualTo(12);
        var db = new JdbcTemplate(old.getConfiguration().getDataSource());
        PrescriptionSchemaTest.seed(db);
        var tables = List.of("users", "specialties", "doctors", "patients", "doctor_schedules",
                "appointments", "medical_records", "prescriptions", "prescription_items",
                "notifications", "flyway_schema_history");
        var before = tables.stream().map(t -> db.queryForList("SELECT * FROM " + t)).toList();

        var upgraded = flyway("D14_UPGRADE_URL", "13");
        assertThat(upgraded.migrate().migrationsExecuted).isOne();
        assertThat(upgraded.validateWithResult().validationSuccessful).isTrue();
        for (int i = 0; i < tables.size(); i++) {
            String filter = tables.get(i).equals("flyway_schema_history") ? " WHERE version<>'13'" : "";
            assertThat(db.queryForList("SELECT * FROM " + tables.get(i) + filter))
                    .as(tables.get(i))
                    .isEqualTo(before.get(i));
        }
        assertThat(db.queryForObject("SELECT COUNT(*) FROM audit_logs", Long.class)).isZero();
        assertThat(upgraded.migrate().migrationsExecuted).isZero();
    }

    static void reject(Runnable action, int mysqlErrorCode) {
        Throwable error = catchThrowable(action::run);
        assertThat(error).isNotNull();
        SQLException sql = null;
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current instanceof SQLException ex) {
                sql = ex;
                break;
            }
        }
        assertThat((Object) sql).as("Expected SQL error " + mysqlErrorCode + " but got " + error).isNotNull();
        assertThat(sql.getErrorCode()).isEqualTo(mysqlErrorCode);
    }
}
