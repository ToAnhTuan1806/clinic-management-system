package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.SQLException;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

@Tag("mysql")
class MedicalHistorySchemaTest {
    private static final String CREATED = "'2026-11-01 01:00:00.123456'";
    private static final String COMPLETED = "'2026-11-01 02:00:00.654321'";

    private Flyway flyway(String variable, String target) {
        String url = System.getenv(variable);
        MySqlTestDatabase.requireIsolatedUrl(url);
        return Flyway.configure().dataSource(url, System.getenv("DB_USERNAME"), System.getenv("DB_PASSWORD"))
                .locations("classpath:db/migration").target(target)
                .cleanDisabled(true).baselineOnMigrate(false).load();
    }

    @Test
    void freshV10ValidatesRepeatsWithoutChangesAndEnforcesReleaseConstraints() {
        var f = flyway("D11_FRESH_URL", "10");
        assertThat(f.migrate().migrationsExecuted).isEqualTo(10);
        assertThat(f.validateWithResult().validationSuccessful).isTrue();
        assertThat(f.migrate().migrationsExecuted).isZero();
        System.out.println("D11_FRESH_FLYWAY_CHECKSUM=" + f.info().current().getChecksum());
        var db = new JdbcTemplate(f.getConfiguration().getDataSource());
        seed(db);
        // New completions after migration do not acquire release metadata implicitly.
        assertThat(db.queryForObject("SELECT COUNT(*) FROM medical_records WHERE released_at IS NOT NULL OR released_by IS NOT NULL", Long.class)).isZero();
        reject(db, "UPDATE medical_records SET released_by=1 WHERE id=1", 3819);
        reject(db, "UPDATE medical_records SET released_at=" + COMPLETED + " WHERE id=1", 3819);
        reject(db, "UPDATE medical_records SET released_at=" + CREATED + ",released_by=1 WHERE id=1", 3819);
        reject(db, "UPDATE medical_records SET released_at=" + COMPLETED + ",released_by=1 WHERE id=4", 3819);
        reject(db, "UPDATE medical_records SET released_at=" + COMPLETED + ",released_by=999999 WHERE id=1", 1452);
        assertThat(db.update("UPDATE medical_records SET released_at=" + COMPLETED + ",released_by=50 WHERE id=1")).isOne();
        reject(db, "DELETE FROM users WHERE id=50", 1451);
        reject(db, "UPDATE users SET id=51 WHERE id=50", 1451);
        reject(db, "UPDATE medical_records SET completed_at=NULL,completed_by=NULL WHERE id=1", 3819);
        assertThat(db.queryForObject("SELECT DATE_FORMAT(released_at,'%Y-%m-%d %H:%i:%s.%f') FROM medical_records WHERE id=1", String.class))
                .isEqualTo("2026-11-01 02:00:00.654321");
        assertThat(db.queryForObject("SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='medical_records' AND column_name='released_at'", String.class)).isEqualTo("datetime");
        assertThat(db.queryForObject("SELECT DATETIME_PRECISION FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='medical_records' AND column_name='released_at'", Integer.class)).isEqualTo(6);
        var before = db.queryForList("SELECT * FROM medical_records ORDER BY id");
        assertThat(f.migrate().migrationsExecuted).isZero();
        assertThat(db.queryForList("SELECT * FROM medical_records ORDER BY id")).isEqualTo(before);
    }

    @Test
    void upgradePreservesAllD10ColumnsAndExistingPatientVisibilityWithoutPublishingDrafts() {
        var old = flyway("D11_UPGRADE_URL", "9");
        assertThat(old.migrate().migrationsExecuted).isEqualTo(9);
        var db = new JdbcTemplate(old.getConfiguration().getDataSource());
        seed(db);
        var history = db.queryForList("SELECT * FROM flyway_schema_history ORDER BY installed_rank");
        var oldRecords = db.queryForList("SELECT * FROM medical_records ORDER BY id");
        var appointments = db.queryForList("SELECT * FROM appointments ORDER BY id");
        var visibleBefore = db.queryForList("SELECT m.id FROM medical_records m JOIN appointments a ON a.id=m.appointment_id WHERE a.status='COMPLETED' AND m.completed_at IS NOT NULL ORDER BY m.id");
        var f = flyway("D11_UPGRADE_URL", "10");
        assertThat(f.migrate().migrationsExecuted).isOne();
        assertThat(f.validateWithResult().validationSuccessful).isTrue();
        assertThat(db.queryForList("SELECT * FROM flyway_schema_history WHERE version <> '10' ORDER BY installed_rank")).isEqualTo(history);
        assertThat(db.queryForList("SELECT * FROM appointments ORDER BY id")).isEqualTo(appointments);
        var newRecords = db.queryForList("SELECT * FROM medical_records ORDER BY id");
        assertThat(newRecords).hasSameSizeAs(oldRecords);
        for (int i = 0; i < oldRecords.size(); i++) {
            for (Map.Entry<String, Object> column : oldRecords.get(i).entrySet()) {
                assertThat(newRecords.get(i).get(column.getKey())).as("unchanged D10 column %s", column.getKey()).isEqualTo(column.getValue());
            }
        }
        assertThat(db.queryForList("SELECT m.id FROM medical_records m JOIN appointments a ON a.id=m.appointment_id WHERE a.status='COMPLETED' AND m.released_at IS NOT NULL ORDER BY m.id")).isEqualTo(visibleBefore);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM medical_records WHERE released_at IS NOT NULL AND (released_at<>completed_at OR released_by<>completed_by)", Long.class)).isZero();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM medical_records WHERE id IN (4,5,6) AND (released_at IS NOT NULL OR released_by IS NOT NULL)", Long.class)).isZero();
        assertThat(db.queryForObject("SELECT COUNT(DISTINCT patient_id) FROM appointments", Long.class)).isEqualTo(3);
        assertThat(db.queryForObject("SELECT COUNT(DISTINCT doctor_id) FROM appointments", Long.class)).isEqualTo(2);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM medical_records WHERE released_at IS NOT NULL", Long.class)).isEqualTo(9);
        var after = db.queryForList("SELECT * FROM medical_records ORDER BY id");
        assertThat(f.migrate().migrationsExecuted).isZero();
        assertThat(db.queryForList("SELECT * FROM medical_records ORDER BY id")).isEqualTo(after);
        System.out.println("D11_UPGRADE_FLYWAY_CHECKSUM=" + f.info().current().getChecksum());
    }

    private static void reject(JdbcTemplate db, String sql, int code) {
        assertThatThrownBy(() -> db.update(sql)).satisfies(error -> {
            Throwable root = error;
            while (root.getCause() != null) root = root.getCause();
            assertThat(root).isInstanceOf(SQLException.class);
            assertThat(((SQLException) root).getErrorCode()).isEqualTo(code);
        });
    }

    private static void seed(JdbcTemplate db) {
        for (int i : new int[]{1,2,3,4,50}) {
            db.update("INSERT INTO users(id,email,password_hash,full_name,role,status,created_at,updated_at) VALUES(?,?,'synthetic-not-login','Synthetic History',?,'ACTIVE'," + CREATED + "," + CREATED + ")",
                    i, "d11-" + i + "@example.test", i <= 2 || i == 50 ? "DOCTOR" : "PATIENT");
        }
        db.update("INSERT INTO specialties(id,code,name,created_at,updated_at) VALUES(1,'D11','Synthetic D11'," + CREATED + "," + CREATED + ")");
        for (int i = 1; i <= 2; i++) {
            db.update("INSERT INTO doctors(id,user_id,specialty_id,doctor_code,created_at,updated_at) VALUES(?,?,1,?," + CREATED + "," + CREATED + ")", i,i,"D11DOC"+i);
            db.update("INSERT INTO doctor_schedules(id,doctor_id,work_date,start_at_utc,end_at_utc,created_at,updated_at) VALUES(?,?,'2026-11-01','2026-11-01 01:00:00','2026-11-01 20:00:00'," + CREATED + "," + CREATED + ")", i,i);
        }
        for (int i = 1; i <= 3; i++) {
            db.update("INSERT INTO patients(id,user_id,patient_code,full_name,created_at,updated_at) VALUES(?,?,?,'Synthetic Patient'," + CREATED + "," + CREATED + ")", i, i == 3 ? null : i+2, "D11PAT"+i);
        }
        for (int i = 1; i <= 12; i++) {
            int doctor = i%2+1;
            String state = i == 4 || i == 6 ? "IN_PROGRESS" : "COMPLETED";
            db.update("INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,start_at_utc,end_at_utc,status,request_key,request_fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,1,TIMESTAMPADD(MINUTE,?," + CREATED + "),TIMESTAMPADD(MINUTE,?," + CREATED + "),?,?,?," + CREATED + "," + CREATED + ")",
                    i,"D11-"+i,(i-1)%3+1,doctor,doctor,i*30,i*30+30,state,"d11-"+i,"a".repeat(64));
            String complete = i == 4 || i == 5 ? "NULL" : COMPLETED;
            String actor = i == 4 || i == 5 ? "NULL" : "1";
            db.update("INSERT INTO medical_records(id,appointment_id,symptoms,diagnosis,notes,conclusion,created_by,completed_at,completed_by,version,created_at,updated_at) VALUES(?,?,'Synthetic symptoms','Synthetic diagnosis','Synthetic note','Synthetic conclusion',1," + complete + "," + actor + ",3," + CREATED + "," + COMPLETED + ")",i,i);
        }
    }
}
