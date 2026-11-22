package com.clinicmanagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

@Tag("mysql")
class PrescriptionSchemaTest {
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
    void freshV11ValidatesRepeatsWithoutChangesAndEnforcesPrescriptionConstraints() {
        var f = flyway("D12_FRESH_URL", "11");
        assertThat(f.migrate().migrationsExecuted).isEqualTo(11);
        assertThat(f.validateWithResult().validationSuccessful).isTrue();
        assertThat(f.migrate().migrationsExecuted).isZero();
        long checksum = f.info().current().getChecksum();
        System.out.println("D12_FRESH_FLYWAY_CHECKSUM=" + checksum);

        var db = new JdbcTemplate(f.getConfiguration().getDataSource());
        seed(db);

        // Verify tables exist and are initially empty
        assertThat(db.queryForObject("SELECT COUNT(*) FROM prescriptions", Long.class)).isZero();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM prescription_items", Long.class)).isZero();

        // 1. UNIQUE medical_record_id: insert prescription for medical_record 1
        assertThat(db.update("INSERT INTO prescriptions(medical_record_id, created_by, created_at, updated_at) VALUES(1, 1, " + CREATED + ", " + CREATED + ")")).isOne();
        Long prescriptionId = db.queryForObject("SELECT id FROM prescriptions WHERE medical_record_id = 1", Long.class);
        assertThat(prescriptionId).isNotNull();

        // Duplicate medical_record_id must be rejected (Error 1062)
        reject(db, "INSERT INTO prescriptions(medical_record_id, created_by, created_at, updated_at) VALUES(1, 1, " + CREATED + ", " + CREATED + ")", 1062);

        // 2. Reject orphan records: FK medical_records & users
        reject(db, "INSERT INTO prescriptions(medical_record_id, created_by, created_at, updated_at) VALUES(99999, 1, " + CREATED + ", " + CREATED + ")", 1452);
        reject(db, "INSERT INTO prescriptions(medical_record_id, created_by, created_at, updated_at) VALUES(2, 99999, " + CREATED + ", " + CREATED + ")", 1452);
        reject(db, "DELETE FROM medical_records WHERE id = 1", 1451);
        reject(db, "DELETE FROM users WHERE id = 1", 1451);

        // 3. Reject orphan prescription_items: FK prescription_id
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(99999, 'Test Med', 10, '1 tab', 'once daily', 5, 'none', 0)", 1452);

        // 4. Test Unicode Vietnamese & valid item insertion
        String medName = "Paracetamol 500mg (Thuốc hạ sốt & giảm đau)";
        String dosage = "1 viên (500mg)";
        String frequency = "2 lần / ngày (sáng - chiều)";
        String instructions = "Uống sau khi ăn no với nước ấm. Không dùng chung với rượu bia.";
        assertThat(db.update("""
                INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order)
                VALUES(?, ?, 20, ?, ?, 10, ?, 0)
                """, prescriptionId, medName, dosage, frequency, instructions)).isOne();

        var item0 = db.queryForMap("SELECT * FROM prescription_items WHERE prescription_id = ? AND sort_order = 0", prescriptionId);
        assertThat(item0.get("medication_name")).isEqualTo(medName);
        assertThat(item0.get("dosage")).isEqualTo(dosage);
        assertThat(item0.get("frequency")).isEqualTo(frequency);
        assertThat(item0.get("instructions")).isEqualTo(instructions);
        assertThat(((Number) item0.get("quantity")).intValue()).isEqualTo(20);
        assertThat(((Number) item0.get("duration_days")).intValue()).isEqualTo(10);

        // 5. UNIQUE (prescription_id, sort_order): duplicate sort_order 0 rejected (Error 1062)
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Amoxicillin 500mg', 10, '1 cap', '3 times daily', 7, NULL, 0)", 1062);

        // 6. Quantity CHECK constraints: 1 to 10000
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Amoxicillin', 0, '1 cap', 'daily', 7, NULL, 1)", 3819);
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Amoxicillin', -1, '1 cap', 'daily', 7, NULL, 1)", 3819);
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Amoxicillin', 10001, '1 cap', 'daily', 7, NULL, 1)", 3819);
        // Valid boundary: quantity = 10000
        assertThat(db.update("INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Vitamin C 500mg', 10000, '1 tab', 'daily', 30, NULL, 1)")).isOne();

        // 7. Duration_days CHECK constraints: 1 to 365
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Ibuprofen', 10, '1 tab', 'daily', 0, NULL, 2)", 3819);
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Ibuprofen', 10, '1 tab', 'daily', -5, NULL, 2)", 3819);
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Ibuprofen', 10, '1 tab', 'daily', 366, NULL, 2)", 3819);
        // Valid boundary: duration_days = 365
        assertThat(db.update("INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Ibuprofen 400mg', 30, '1 tab', 'daily', 365, NULL, 2)")).isOne();

        // 8. Sort_order CHECK constraints: sort_order >= 0
        reject(db, "INSERT INTO prescription_items(prescription_id, medication_name, quantity, dosage, frequency, duration_days, instructions, sort_order) VALUES(" + prescriptionId + ", 'Aspirin', 10, '1 tab', 'daily', 7, NULL, -1)", 3819);

        // 9. Sort order verification: items retrieved in correct sort_order sequence
        List<Integer> orders = db.queryForList("SELECT sort_order FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order ASC", Integer.class, prescriptionId);
        assertThat(orders).containsExactly(0, 1, 2);

        // 10. Check index structure: no duplicate index on unique columns
        List<String> prescIndexes = db.queryForList("""
                SELECT DISTINCT INDEX_NAME FROM information_schema.statistics
                WHERE table_schema = DATABASE() AND table_name = 'prescriptions'
                """, String.class);
        assertThat(prescIndexes).containsExactlyInAnyOrder("PRIMARY", "uk_prescriptions_medical_record", "ix_prescriptions_created_by");

        List<String> itemIndexes = db.queryForList("""
                SELECT DISTINCT INDEX_NAME FROM information_schema.statistics
                WHERE table_schema = DATABASE() AND table_name = 'prescription_items'
                """, String.class);
        assertThat(itemIndexes).containsExactlyInAnyOrder("PRIMARY", "uk_prescription_items_prescription_sort");

        // 11. Cannot delete prescription when items exist
        reject(db, "DELETE FROM prescriptions WHERE id = " + prescriptionId, 1451);

        // Re-migration test: migrate() again executes zero migrations
        assertThat(f.migrate().migrationsExecuted).isZero();
    }

    @Test
    void upgradePreservesAllHistoricalDataAndTablesWithoutUnintendedChanges() {
        var old = flyway("D12_UPGRADE_URL", "10");
        assertThat(old.migrate().migrationsExecuted).isEqualTo(10);
        var db = new JdbcTemplate(old.getConfiguration().getDataSource());
        seed(db);

        var history = db.queryForList("SELECT * FROM flyway_schema_history ORDER BY installed_rank");
        var oldRecords = db.queryForList("SELECT * FROM medical_records ORDER BY id");
        var appointments = db.queryForList("SELECT * FROM appointments ORDER BY id");
        var users = db.queryForList("SELECT * FROM users ORDER BY id");

        // Apply V11 migration
        var f = flyway("D12_UPGRADE_URL", "11");
        assertThat(f.migrate().migrationsExecuted).isOne();
        assertThat(f.validateWithResult().validationSuccessful).isTrue();

        long checksum = f.info().current().getChecksum();
        System.out.println("D12_UPGRADE_FLYWAY_CHECKSUM=" + checksum);

        // Historical migrations V1-V10 in flyway history remain identical
        assertThat(db.queryForList("SELECT * FROM flyway_schema_history WHERE version <> '11' ORDER BY installed_rank")).isEqualTo(history);

        // Historical tables remain untouched
        assertThat(db.queryForList("SELECT * FROM appointments ORDER BY id")).isEqualTo(appointments);
        assertThat(db.queryForList("SELECT * FROM users ORDER BY id")).isEqualTo(users);

        var newRecords = db.queryForList("SELECT * FROM medical_records ORDER BY id");
        assertThat(newRecords).hasSameSizeAs(oldRecords);
        for (int i = 0; i < oldRecords.size(); i++) {
            for (Map.Entry<String, Object> column : oldRecords.get(i).entrySet()) {
                assertThat(newRecords.get(i).get(column.getKey())).as("unchanged medical_records column %s", column.getKey()).isEqualTo(column.getValue());
            }
        }

        // New tables exist and are empty: no fake prescriptions backfilled
        assertThat(db.queryForObject("SELECT COUNT(*) FROM prescriptions", Long.class)).isZero();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM prescription_items", Long.class)).isZero();

        // Re-migration test: migrate() again executes zero migrations
        assertThat(f.migrate().migrationsExecuted).isZero();
    }

    private static void reject(JdbcTemplate db, String sql, int code) {
        assertThatThrownBy(() -> db.update(sql)).satisfies(error -> {
            Throwable root = error;
            while (root.getCause() != null) root = root.getCause();
            assertThat(root).isInstanceOf(SQLException.class);
            assertThat(((SQLException) root).getErrorCode()).isEqualTo(code);
        });
    }

    static void seed(JdbcTemplate db) {
        for (int i : new int[]{1, 2, 3, 4, 50}) {
            db.update("INSERT INTO users(id,email,password_hash,full_name,role,status,created_at,updated_at) VALUES(?,?,'synthetic-not-login','Synthetic History',?,'ACTIVE'," + CREATED + "," + CREATED + ")",
                    i, "d12-" + i + "@example.test", i <= 2 || i == 50 ? "DOCTOR" : "PATIENT");
        }
        db.update("INSERT INTO specialties(id,code,name,created_at,updated_at) VALUES(1,'D12','Synthetic D12'," + CREATED + "," + CREATED + ")");
        for (int i = 1; i <= 2; i++) {
            db.update("INSERT INTO doctors(id,user_id,specialty_id,doctor_code,created_at,updated_at) VALUES(?,?,1,?," + CREATED + "," + CREATED + ")", i, i, "D12DOC" + i);
            db.update("INSERT INTO doctor_schedules(id,doctor_id,work_date,start_at_utc,end_at_utc,created_at,updated_at) VALUES(?,?,'2026-11-01','2026-11-01 01:00:00','2026-11-01 20:00:00'," + CREATED + "," + CREATED + ")", i, i);
        }
        for (int i = 1; i <= 3; i++) {
            db.update("INSERT INTO patients(id,user_id,patient_code,full_name,created_at,updated_at) VALUES(?,?,?,'Synthetic Patient'," + CREATED + "," + CREATED + ")", i, i == 3 ? null : i + 2, "D12PAT" + i);
        }
        for (int i = 1; i <= 4; i++) {
            int doctor = i % 2 + 1;
            String state = i == 4 ? "IN_PROGRESS" : "COMPLETED";
            db.update("INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,start_at_utc,end_at_utc,status,request_key,request_fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,1,TIMESTAMPADD(MINUTE,?," + CREATED + "),TIMESTAMPADD(MINUTE,?," + CREATED + "),?,?,?," + CREATED + "," + CREATED + ")",
                    i, "D12-" + i, (i - 1) % 3 + 1, doctor, doctor, i * 30, i * 30 + 30, state, "d12-" + i, "a".repeat(64));
            String complete = i == 4 ? "NULL" : COMPLETED;
            String actor = i == 4 ? "NULL" : "1";
            db.update("INSERT INTO medical_records(id,appointment_id,symptoms,diagnosis,notes,conclusion,created_by,completed_at,completed_by,version,created_at,updated_at) VALUES(?,?,'Synthetic symptoms','Synthetic diagnosis','Synthetic note','Synthetic conclusion',1," + complete + "," + actor + ",3," + CREATED + "," + COMPLETED + ")", i, i);
        }
    }
}
