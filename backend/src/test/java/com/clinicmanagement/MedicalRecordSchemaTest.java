package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.transaction.support.TransactionTemplate;

class MedicalRecordSchemaTest {
    private static final String NOW = "'2026-11-25 04:00:00.123456'";
    private static final String DRAFT = """
            INSERT INTO medical_records (appointment_id, created_by, created_at, updated_at)
            VALUES (?, ?, %s, %s)
            """.formatted(NOW, NOW);

    @Test
    void h2FixtureEnforcesTheSameCoreConstraints() throws Exception {
        try (var connection = DriverManager.getConnection("jdbc:h2:mem:" + UUID.randomUUID(), "sa", "")) {
            for (String fixture : List.of("users", "catalog", "patient", "schedule", "appointment", "medical-record")) {
                ScriptUtils.executeSqlScript(connection, new ClassPathResource("fixtures/" + fixture + "-schema.sql"));
            }
            var db = jdbc(connection);
            seed(db);
            constraints(db);
        }
    }

    @Tag("mysql")
    @Test
    void upgradesV8AndPreservesHistoryAndAppointments() {
        String url = System.getenv("D10_UPGRADE_URL");
        MySqlTestDatabase.requireIsolatedUrl(url);
        var config = Flyway.configure().dataSource(url, System.getenv("DB_USERNAME"), System.getenv("DB_PASSWORD"))
                .locations("classpath:db/migration").cleanDisabled(true).baselineOnMigrate(false);
        var v8 = config.target("8").load();
        assertThat(v8.migrate().migrationsExecuted).isEqualTo(8);
        var db = new JdbcTemplate(v8.getConfiguration().getDataSource());
        seed(db);
        var history = db.queryForList("SELECT * FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank");
        var appointments = db.queryForList("SELECT * FROM appointments");
        var v9 = config.target("9").load();
        assertThat(v9.migrate().migrationsExecuted).isOne();
        assertThat(db.queryForList("SELECT * FROM flyway_schema_history WHERE version <> '9' ORDER BY installed_rank"))
                .isEqualTo(history);
        assertThat(db.queryForList("SELECT * FROM appointments")).isEqualTo(appointments);
        assertThat(v9.validateWithResult().validationSuccessful).isTrue();
        assertThat(v9.migrate().migrationsExecuted).isZero();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM medical_records", Long.class)).isZero();
        System.out.println("D10_UPGRADE_FLYWAY_CHECKSUM=" + v9.info().current().getChecksum());
        constraints(db);
        var transaction = new TransactionTemplate(new DataSourceTransactionManager(db.getDataSource()));
        sqlRejected(() -> transaction.executeWithoutResult(status -> {
            db.update("UPDATE appointments SET status='IN_PROGRESS' WHERE id=1");
            db.update(DRAFT, 1, 1);
        }));
        assertThat(db.queryForObject("SELECT status FROM appointments WHERE id=1", String.class)).isEqualTo("CHECKED_IN");
        db.update("UPDATE appointments SET status='IN_PROGRESS' WHERE id=1");
        sqlRejected(() -> transaction.executeWithoutResult(status -> {
            db.update("UPDATE appointments SET status='COMPLETED' WHERE id=1");
            db.update("UPDATE medical_records SET completed_at=" + NOW + ", completed_by=2 WHERE appointment_id=1");
        }));
        assertThat(db.queryForObject("SELECT status FROM appointments WHERE id=1", String.class)).isEqualTo("IN_PROGRESS");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM medical_records WHERE completed_at IS NULL", Long.class)).isOne();
    }

    @Tag("mysql")
    @Test
    void freshV9ValidatesAndConcurrentWritesRespectUniqueAndVersionGuards() throws Exception {
        String url = System.getenv("D10_FRESH_URL");
        MySqlTestDatabase.requireIsolatedUrl(url);
        var f = Flyway.configure().dataSource(url, System.getenv("DB_USERNAME"), System.getenv("DB_PASSWORD"))
                .locations("classpath:db/migration").cleanDisabled(true).baselineOnMigrate(false).load();
        assertThat(f.migrate().migrationsExecuted).isEqualTo(9);
        assertThat(f.validateWithResult().validationSuccessful).isTrue();
        assertThat(f.migrate().migrationsExecuted).isZero();
        System.out.println("D10_FRESH_FLYWAY_CHECKSUM=" + f.info().current().getChecksum());
        var db = new JdbcTemplate(f.getConfiguration().getDataSource());
        seed(db);
        assertThat(race(() -> {
            try {
                return db.update(DRAFT, 1, 1);
            } catch (org.springframework.dao.DuplicateKeyException expected) {
                return 0;
            }
        })).containsExactlyInAnyOrder(1, 0);
        assertThat(race(() -> db.update("""
                UPDATE medical_records SET notes='Synthetic draft', version=version+1
                WHERE appointment_id=1 AND version=0 AND completed_at IS NULL
                """))).containsExactlyInAnyOrder(1, 0);
        assertThat(race(() -> db.update("""
                UPDATE medical_records SET completed_at=%s, completed_by=1, version=version+1
                WHERE appointment_id=1 AND version=1 AND completed_at IS NULL
                """.formatted(NOW)))).containsExactlyInAnyOrder(1, 0);
        assertThat(db.update("UPDATE medical_records SET notes=NULL WHERE appointment_id=1 AND completed_at IS NULL")).isZero();
        assertThat(db.queryForObject("SELECT version FROM medical_records WHERE appointment_id=1", Long.class)).isEqualTo(2);
    }

    private static List<Integer> race(Callable<Integer> operation) throws Exception {
        var barrier = new CyclicBarrier(2);
        Callable<Integer> contender = () -> {
            barrier.await(10, TimeUnit.SECONDS);
            return operation.call();
        };
        var pool = Executors.newFixedThreadPool(2);
        try {
            var a = pool.submit(contender);
            var b = pool.submit(contender);
            return List.of(a.get(15, TimeUnit.SECONDS), b.get(15, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }

    private static void constraints(JdbcTemplate db) {
        sqlRejected(() -> db.update(DRAFT, 2, 1));
        sqlRejected(() -> db.update(DRAFT, 1, 2));
        assertThat(db.update(DRAFT, 1, 1)).isOne();
        assertThat(db.queryForObject("""
                SELECT COUNT(*) FROM medical_records WHERE id > 0 AND version=0 AND symptoms IS NULL
                AND diagnosis IS NULL AND notes IS NULL AND conclusion IS NULL
                AND completed_at IS NULL AND completed_by IS NULL
                """, Long.class)).isOne();
        sqlRejected(() -> db.update(DRAFT, 1, 1));
        sqlRejected(() -> db.update("UPDATE medical_records SET version=-1"));
        sqlRejected(() -> db.update("UPDATE medical_records SET completed_by=1"));
        sqlRejected(() -> db.update("UPDATE medical_records SET completed_at=" + NOW + ", completed_by=2"));
        sqlRejected(() -> db.update("DELETE FROM appointments WHERE id=1"));
    }

    private static void sqlRejected(Runnable statement) {
        assertThatThrownBy(statement::run).hasRootCauseInstanceOf(SQLException.class);
    }

    private static JdbcTemplate jdbc(Connection connection) {
        return new JdbcTemplate(new SingleConnectionDataSource(connection, true));
    }

    private static void seed(JdbcTemplate db) {
        db.update("INSERT INTO users(id,email,password_hash,full_name,role,status,created_at,updated_at) "
                + "VALUES (1,'d10@example.test','synthetic-test-only','Synthetic Doctor','DOCTOR','ACTIVE'," + NOW + "," + NOW + ")");
        db.update("INSERT INTO specialties(id,code,name,is_active,created_at,updated_at) "
                + "VALUES (1,'D10','Synthetic Specialty',TRUE," + NOW + "," + NOW + ")");
        db.update("INSERT INTO doctors(id,user_id,specialty_id,doctor_code,is_active,created_at,updated_at) "
                + "VALUES (1,1,1,'D10',TRUE," + NOW + "," + NOW + ")");
        db.update("INSERT INTO patients(id,patient_code,full_name,is_active,created_at,updated_at) "
                + "VALUES (1,'D10','Synthetic Patient',TRUE," + NOW + "," + NOW + ")");
        db.update("""
                INSERT INTO doctor_schedules(id,doctor_id,work_date,start_at_utc,end_at_utc,slot_minutes,status,created_at,updated_at)
                VALUES (1,1,'2026-11-25','2026-11-25 03:00:00','2026-11-25 05:00:00',30,'ACTIVE',%s,%s)
                """.formatted(NOW, NOW));
        db.update("""
                INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,start_at_utc,
                end_at_utc,status,request_key,request_fingerprint,created_at,updated_at)
                VALUES (1,'D10',1,1,1,1,'2026-11-25 04:00:00','2026-11-25 04:30:00','CHECKED_IN','d10',?,%s,%s)
                """.formatted(NOW, NOW), "a".repeat(64));
    }
}
