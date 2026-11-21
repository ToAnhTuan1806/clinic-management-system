import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.flywaydb.core.Flyway;

/**
 * CL-D07-DB MySQL validation: appointments table via Flyway V6.
 * Tests V1 -> V2 -> V3 -> V4 -> V5 -> V6 upgrade, idempotency, schema, constraints,
 * composite FK (schedule_id, doctor_id), generated active slot uniqueness,
 * cancellation rebooking with historical preservation, request_key idempotency,
 * multithreaded concurrent double-booking locking protocol, and V1-V5 compatibility.
 * Requires isolated MySQL 8.4 QA instance; no clean/repair/baseline/drop.
 */
class D07DatabaseValidation {
    static Connection db;
    static int passed;
    static final String NOW = "'2026-11-21 09:10:11.123456'";

    static void check(String id, boolean result) {
        if (!result) throw new AssertionError(id);
        passed++;
        System.out.println("PASS " + id);
    }

    static String env(String key) {
        String v = System.getenv(key);
        if (v == null || v.isBlank()) throw new IllegalStateException("Missing QA variable: " + key);
        return v;
    }

    static Flyway flyway(String url, String location, String target) {
        var config = Flyway.configure().dataSource(url, env("DB_USERNAME"), env("DB_PASSWORD"))
                .locations("filesystem:" + Path.of(location).toAbsolutePath().toString().replace('\\', '/'))
                .baselineOnMigrate(false).cleanDisabled(true).validateMigrationNaming(true);
        if (target != null) config.target(target);
        return config.load();
    }

    static String scalar(String query) throws SQLException {
        try (var s = db.createStatement(); var r = s.executeQuery(query)) {
            r.next();
            return r.getString(1);
        }
    }

    static long count(String query) throws SQLException {
        return Long.parseLong(scalar(query));
    }

    static void execute(String sql) throws SQLException {
        try (var s = db.createStatement()) {
            s.executeUpdate(sql);
        }
    }

    static List<String> rows(String query) throws SQLException {
        List<String> values = new ArrayList<>();
        try (var s = db.createStatement(); var r = s.executeQuery(query)) {
            while (r.next()) {
                var row = new ArrayList<String>();
                for (int i = 1; i <= r.getMetaData().getColumnCount(); i++) row.add(r.getString(i));
                values.add(String.join("|", row));
            }
        }
        return values;
    }

    static List<String> columns(String table) throws SQLException {
        return rows("SELECT column_name,column_type,is_nullable,COALESCE(column_default,'<NULL>'),extra,COALESCE(collation_name,'<NULL>') "
                + "FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='" + table + "' ORDER BY ordinal_position");
    }

    interface SqlAction {
        void run() throws SQLException;
    }

    static void rejects(String id, int code, SqlAction action) throws SQLException {
        Savepoint save = db.setSavepoint();
        try {
            action.run();
            throw new AssertionError(id + " accepted invalid data");
        } catch (SQLException error) {
            check(id, error.getErrorCode() == code);
        } finally {
            db.rollback(save);
            db.releaseSavepoint(save);
        }
    }

    static long insertUser(int index, String role) throws SQLException {
        try (var s = db.prepareStatement("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) "
                + "VALUES (?, 'synthetic-non-authenticating-fixture', ?, ?, 'ACTIVE', " + NOW + ", " + NOW + ")",
                Statement.RETURN_GENERATED_KEYS)) {
            s.setString(1, "d07-user-" + index + "@example.test");
            s.setString(2, "QA User " + index);
            s.setString(3, role);
            s.executeUpdate();
            try (var keys = s.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    static long specialty(String code, String name) throws SQLException {
        try (var s = db.prepareStatement("INSERT INTO specialties(code,name,created_at,updated_at) VALUES (?, ?," + NOW + "," + NOW + ")",
                Statement.RETURN_GENERATED_KEYS)) {
            s.setString(1, code);
            s.setString(2, name);
            s.executeUpdate();
            try (var keys = s.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    static long doctor(long user, long specialty, String code, String license) throws SQLException {
        try (var s = db.prepareStatement("INSERT INTO doctors(user_id,specialty_id,doctor_code,license_number,created_at,updated_at) "
                + "VALUES (?,?,?, ?," + NOW + "," + NOW + ")", Statement.RETURN_GENERATED_KEYS)) {
            s.setLong(1, user);
            s.setLong(2, specialty);
            s.setString(3, code);
            s.setString(4, license);
            s.executeUpdate();
            try (var keys = s.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    static long patient(long user, String code, String name) throws SQLException {
        try (var s = db.prepareStatement("INSERT INTO patients(user_id,patient_code,full_name,date_of_birth,sex,phone,address,is_active,created_at,updated_at) "
                + "VALUES (?,?,?, '1990-05-15', 'MALE', '0901234567', '123 QA Street', 1, " + NOW + ", " + NOW + ")",
                Statement.RETURN_GENERATED_KEYS)) {
            s.setLong(1, user);
            s.setString(2, code);
            s.setString(3, name);
            s.executeUpdate();
            try (var keys = s.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    static long schedule(long doctorId, String workDate, String startUtc, String endUtc, int slotMinutes, String status) throws SQLException {
        String sql = "INSERT INTO doctor_schedules(doctor_id, work_date, start_at_utc, end_at_utc, slot_minutes, status, version, created_at, updated_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, 0, " + NOW + ", " + NOW + ")";
        try (var s = db.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            s.setLong(1, doctorId);
            s.setDate(2, java.sql.Date.valueOf(workDate));
            s.setTimestamp(3, Timestamp.valueOf(startUtc));
            s.setTimestamp(4, Timestamp.valueOf(endUtc));
            s.setInt(5, slotMinutes);
            s.setString(6, status);
            s.executeUpdate();
            try (var keys = s.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    static long appointment(String code, long patientId, long doctorId, long scheduleId, long createdBy,
                            String startUtc, String endUtc, String status, String reason,
                            String requestKey, String fingerprint) throws SQLException {
        String sql = "INSERT INTO appointments(appointment_code, patient_id, doctor_id, schedule_id, created_by, "
                + "start_at_utc, end_at_utc, status, reason, request_key, request_fingerprint, version, created_at, updated_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, " + NOW + ", " + NOW + ")";
        try (var s = db.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            s.setString(1, code);
            s.setLong(2, patientId);
            s.setLong(3, doctorId);
            s.setLong(4, scheduleId);
            s.setLong(5, createdBy);
            s.setTimestamp(6, Timestamp.valueOf(startUtc));
            s.setTimestamp(7, Timestamp.valueOf(endUtc));
            s.setString(8, status);
            s.setString(9, reason);
            s.setString(10, requestKey);
            s.setString(11, fingerprint);
            s.executeUpdate();
            try (var keys = s.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    static void schemaChecks() throws SQLException {
        // Table count: users, specialties, doctors, patients, doctor_schedules, appointments, flyway_schema_history
        check("SCHEMA-TABLES-TOTAL", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 7);
        check("SCHEMA-APPOINTMENTS-TABLE-EXISTS", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND engine='InnoDB' AND table_collation='utf8mb4_0900_ai_ci'") == 1);

        // Columns check (exactly 16 columns)
        check("SCHEMA-APPOINTMENTS-COLUMN-COUNT", columns("appointments").size() == 16);

        // Column types and nullability
        check("SCHEMA-COL-ID", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='id' AND column_type='bigint' AND extra='auto_increment' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-CODE", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='appointment_code' AND column_type='varchar(32)' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-PATIENT-ID", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='patient_id' AND column_type='bigint' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-DOCTOR-ID", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='doctor_id' AND column_type='bigint' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-SCHEDULE-ID", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='schedule_id' AND column_type='bigint' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-CREATED-BY", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='created_by' AND column_type='bigint' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-START-UTC", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='start_at_utc' AND column_type='datetime(6)' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-END-UTC", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='end_at_utc' AND column_type='datetime(6)' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-STATUS", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='status' AND column_type='varchar(16)' AND is_nullable='NO' AND column_default='PENDING'") == 1);
        check("SCHEMA-COL-REASON", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='reason' AND column_type='varchar(500)' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-REQUEST-KEY", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='request_key' AND column_type='varchar(64)' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-REQUEST-FINGERPRINT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='request_fingerprint' AND column_type='char(64)' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-ACTIVE-SLOT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='active_slot_start_utc' AND column_type='datetime(6)' AND extra LIKE '%STORED GENERATED%' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-VERSION", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='version' AND column_type='bigint' AND is_nullable='NO' AND column_default='0'") == 1);
        check("SCHEMA-COL-TIMESTAMPS", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name IN ('created_at','updated_at') AND column_type='datetime(6)' AND is_nullable='NO'") == 2);

        // Schedule composite referenced key
        check("SCHEMA-SCHEDULES-UK-ID-DOCTOR", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND index_name='uk_doctor_schedules_id_doctor'") == 1);

        // Foreign keys with RESTRICT
        check("SCHEMA-FK-PATIENT", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='fk_appointments_patient' AND referenced_table_name='patients' AND delete_rule='RESTRICT'") == 1);
        check("SCHEMA-FK-DOCTOR", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='fk_appointments_doctor' AND referenced_table_name='doctors' AND delete_rule='RESTRICT'") == 1);
        check("SCHEMA-FK-SCHEDULE", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='fk_appointments_schedule' AND referenced_table_name='doctor_schedules' AND delete_rule='RESTRICT'") == 1);
        check("SCHEMA-FK-SCHEDULE-DOCTOR-COMPOSITE", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='fk_appointments_schedule_doctor' AND referenced_table_name='doctor_schedules' AND delete_rule='RESTRICT'") == 1);
        check("SCHEMA-FK-CREATED-BY", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='fk_appointments_created_by' AND referenced_table_name='users' AND delete_rule='RESTRICT'") == 1);

        // Check constraints enforced (7 check constraints on appointments)
        check("SCHEMA-CHECKS-ENFORCED", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_type='CHECK' AND enforced='YES'") == 7);
        check("SCHEMA-CHECK-CODE", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_code'") == 1);
        check("SCHEMA-CHECK-TIME-RANGE", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_time_range'") == 1);
        check("SCHEMA-CHECK-STATUS", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_status'") == 1);
        check("SCHEMA-CHECK-REASON", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_reason'") == 1);
        check("SCHEMA-CHECK-REQUEST-KEY", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_request_key'") == 1);
        check("SCHEMA-CHECK-FINGERPRINT", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_request_fingerprint'") == 1);
        check("SCHEMA-CHECK-VERSION", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_version'") == 1);

        // Unique constraints
        check("SCHEMA-UK-CODE", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND index_name='uk_appointments_code' AND non_unique=0") == 1);
        check("SCHEMA-UK-REQUEST-KEY", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND index_name='uk_appointments_created_by_request_key' AND non_unique=0") == 1);
        check("SCHEMA-UK-ACTIVE-SLOT", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND index_name='uk_appointments_doctor_active_slot' AND non_unique=0") == 1);

        // Query performance indexes
        check("SCHEMA-IX-DOCTOR-TIME-STATUS", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND index_name='ix_appointments_doctor_time_status'") == 1);
        check("SCHEMA-IX-PATIENT-START-ID", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND index_name='ix_appointments_patient_start_id'") == 1);
        check("SCHEMA-IX-STATUS-START-ID", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND index_name='ix_appointments_status_start_id'") == 1);
    }

    static void dataChecks() throws SQLException {
        db.setAutoCommit(false);

        long uDoctor1 = insertUser(701, "DOCTOR");
        long uDoctor2 = insertUser(702, "DOCTOR");
        long uPatient1 = insertUser(703, "PATIENT");
        long uPatient2 = insertUser(704, "PATIENT");
        long uReceptionist = insertUser(705, "RECEPTIONIST");

        long spec = specialty("D07_SPEC_CAR", "Cardiology QA D07");
        long doc1 = doctor(uDoctor1, spec, "D07_DOC_1", "LIC_D07_1");
        long doc2 = doctor(uDoctor2, spec, "D07_DOC_2", "LIC_D07_2");

        long pat1 = patient(uPatient1, "D07_PAT_1", "Patient QA One");
        long pat2 = patient(uPatient2, "D07_PAT_2", "Patient QA Two");

        long sch1 = schedule(doc1, "2026-11-25", "2026-11-25 01:00:00.000000", "2026-11-25 05:00:00.000000", 30, "ACTIVE");
        long sch2 = schedule(doc2, "2026-11-25", "2026-11-25 01:00:00.000000", "2026-11-25 05:00:00.000000", 30, "ACTIVE");

        String fp1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        String fp2 = "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e";

        // 1. Insert valid appointment with default status PENDING
        long app1 = appointment("APP-D07-001", pat1, doc1, sch1, uPatient1,
                "2026-11-25 01:00:00.000000", "2026-11-25 01:30:00.000000", "PENDING", "Regular checkup",
                "req-key-001", fp1);
        check("DATA-INSERT-VALID-APPOINTMENT", app1 > 0);

        // Verify generated active_slot_start_utc is populated
        check("DATA-ACTIVE-SLOT-STORED-FOR-PENDING",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app1)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + app1)));

        // 2. Double booking prevention: Patient 2 tries to book the EXACT SAME SLOT for Doctor 1 -> Error 1062
        rejects("UNIQUE-ACTIVE-SLOT-DOUBLE-BOOKING-REJECTED", 1062, () -> appointment("APP-D07-002", pat2, doc1, sch1, uPatient2,
                "2026-11-25 01:00:00.000000", "2026-11-25 01:30:00.000000", "PENDING", "Competing checkup",
                "req-key-002", fp2));

        // 3. Different doctor for the SAME slot time is ALLOWED
        long appDoc2 = appointment("APP-D07-003", pat2, doc2, sch2, uPatient2,
                "2026-11-25 01:00:00.000000", "2026-11-25 01:30:00.000000", "PENDING", "Checkup with Doc 2",
                "req-key-003", fp2);
        check("DATA-DIFFERENT-DOCTOR-SAME-SLOT-ALLOWED", appDoc2 > 0);

        // 4. Same doctor for an ADJACENT / DIFFERENT slot time is ALLOWED
        long appAdjacent = appointment("APP-D07-004", pat2, doc1, sch1, uPatient2,
                "2026-11-25 01:30:00.000000", "2026-11-25 02:00:00.000000", "PENDING", "Adjacent slot checkup",
                "req-key-004", fp2);
        check("DATA-ADJACENT-SLOT-ALLOWED", appAdjacent > 0);

        // 5. Lifecycle states verification: CONFIRMED, CHECKED_IN, IN_PROGRESS, COMPLETED, NO_SHOW
        for (String st : List.of("CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW")) {
            execute("UPDATE appointments SET status='" + st + "' WHERE id=" + appDoc2);
            check("DATA-STATUS-ALLOWED-" + st, st.equals(scalar("SELECT status FROM appointments WHERE id=" + appDoc2)));
            // active_slot_start_utc remains non-null for all these states
            check("DATA-ACTIVE-SLOT-RETAINED-" + st, scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + appDoc2) != null);
        }

        // 6. Cancellation releases active slot and allows re-booking with full historical preservation
        // Patient 1 cancels app1
        execute("UPDATE appointments SET status='CANCELLED' WHERE id=" + app1);
        check("DATA-CANCELLED-STATUS-UPDATED", "CANCELLED".equals(scalar("SELECT status FROM appointments WHERE id=" + app1)));
        check("DATA-CANCELLED-RELEASES-ACTIVE-SLOT", scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app1) == null);

        // Now Patient 2 can successfully book the cancelled slot for Doctor 1
        long appRebooked = appointment("APP-D07-005", pat2, doc1, sch1, uPatient2,
                "2026-11-25 01:00:00.000000", "2026-11-25 01:30:00.000000", "PENDING", "Rebooked slot",
                "req-key-005", fp2);
        check("DATA-REBOOK-CANCELLED-SLOT-SUCCESS", appRebooked > app1);
        check("DATA-REBOOKED-SLOT-NOW-ACTIVE",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + appRebooked)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + appRebooked)));

        // Verify BOTH appointments exist in the table (history preserved)
        check("DATA-HISTORY-PRESERVED-BOTH-RECORDS-EXIST",
                count("SELECT COUNT(*) FROM appointments WHERE doctor_id=" + doc1 + " AND start_at_utc=(SELECT start_at_utc FROM appointments WHERE id=" + app1 + ")") == 2);

        // Now if another request tries to book this slot again, it is blocked
        rejects("DATA-SLOT-REBLOCKED-AFTER-REBOOKING", 1062, () -> appointment("APP-D07-006", pat1, doc1, sch1, uPatient1,
                "2026-11-25 01:00:00.000000", "2026-11-25 01:30:00.000000", "PENDING", "Third attempt",
                "req-key-006", fp1));

        // When the rebooked appointment is ALSO cancelled, both cancelled records coexist (multiple NULL active_slots)
        execute("UPDATE appointments SET status='CANCELLED' WHERE id=" + appRebooked);
        check("DATA-MULTIPLE-CANCELLED-RECORDS-COEXIST",
                count("SELECT COUNT(*) FROM appointments WHERE doctor_id=" + doc1
                        + " AND start_at_utc=(SELECT start_at_utc FROM appointments WHERE id=" + app1 + ") AND status='CANCELLED' AND active_slot_start_utc IS NULL") == 2);

        // 7. Composite FK enforcement: schedule_id MUST belong to doctor_id
        // Try inserting appointment with doc1 but schedule sch2 (which belongs to doc2) -> rejected Error 1452
        rejects("COMPOSITE-FK-SCHEDULE-DOCTOR-MISMATCH", 1452, () -> appointment("APP-D07-007", pat1, doc1, sch2, uPatient1,
                "2026-11-25 02:00:00.000000", "2026-11-25 02:30:00.000000", "PENDING", "Mismatched doctor and schedule",
                "req-key-007", fp1));

        // 8. Idempotency test: duplicate (created_by, request_key) rejected Error 1062
        rejects("IDEMPOTENCY-DUPLICATE-REQUEST-KEY-REJECTED", 1062, () -> appointment("APP-D07-008", pat1, doc1, sch1, uPatient1,
                "2026-11-25 03:00:00.000000", "2026-11-25 03:30:00.000000", "PENDING", "Duplicate key",
                "req-key-001", fp1)); // req-key-001 was used by uPatient1

        // Different user using the same request_key is allowed
        long appDiffUserKey = appointment("APP-D07-009", pat2, doc1, sch1, uReceptionist,
                "2026-11-25 03:00:00.000000", "2026-11-25 03:30:00.000000", "PENDING", "Receptionist booking with same key name",
                "req-key-001", fp1);
        check("IDEMPOTENCY-DIFFERENT-USER-SAME-KEY-ALLOWED", appDiffUserKey > 0);

        // 9. Negative constraint tests
        rejects("CHECK-START-EQUALS-END", 3819, () -> appointment("APP-ERR-01", pat1, doc1, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:00:00.000000", "PENDING", "Bad time", "req-err-01", fp1));
        rejects("CHECK-START-GREATER-THAN-END", 3819, () -> appointment("APP-ERR-02", pat1, doc1, sch1, uPatient1,
                "2026-11-25 04:30:00.000000", "2026-11-25 04:00:00.000000", "PENDING", "Bad time", "req-err-02", fp1));
        rejects("CHECK-STATUS-INVALID", 3819, () -> appointment("APP-ERR-03", pat1, doc1, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "UNKNOWN_STATUS", "Bad status", "req-err-03", fp1));
        rejects("CHECK-VERSION-NEGATIVE", 3819, () -> execute("UPDATE appointments SET version=-1 WHERE id=" + appAdjacent));
        rejects("CHECK-REASON-TOO-LONG", 1406, () -> appointment("APP-ERR-04", pat1, doc1, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "x".repeat(501), "req-err-04", fp1));
        rejects("CHECK-CODE-EMPTY", 3819, () -> appointment("", pat1, doc1, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "Empty code", "req-err-05", fp1));
        rejects("CHECK-REQUEST-KEY-EMPTY", 3819, () -> appointment("APP-ERR-06", pat1, doc1, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "Empty key", "   ", fp1));
        rejects("CHECK-FINGERPRINT-INVALID-LENGTH", 3819, () -> appointment("APP-ERR-07", pat1, doc1, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "Short fp", "req-err-07", "abc"));
        rejects("CHECK-FINGERPRINT-UPPERCASE", 3819, () -> appointment("APP-ERR-08", pat1, doc1, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "Upper fp", "req-err-08", fp1.toUpperCase()));

        // 10. FK orphan checks
        rejects("FK-ORPHAN-PATIENT", 1452, () -> appointment("APP-ERR-09", 9223372036854775806L, doc1, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "Orphan pat", "req-err-09", fp1));
        rejects("FK-ORPHAN-DOCTOR", 1452, () -> appointment("APP-ERR-10", pat1, 9223372036854775806L, sch1, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "Orphan doc", "req-err-10", fp1));
        rejects("FK-ORPHAN-SCHEDULE", 1452, () -> appointment("APP-ERR-11", pat1, doc1, 9223372036854775806L, uPatient1,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "Orphan sch", "req-err-11", fp1));
        rejects("FK-ORPHAN-CREATED-BY", 1452, () -> appointment("APP-ERR-12", pat1, doc1, sch1, 9223372036854775806L,
                "2026-11-25 04:00:00.000000", "2026-11-25 04:30:00.000000", "PENDING", "Orphan creator", "req-err-12", fp1));

        // 11. FK RESTRICT: Cannot delete doctor, patient, schedule, or creator when referenced
        rejects("FK-DELETE-DOCTOR-BLOCKED", 1451, () -> execute("DELETE FROM doctors WHERE id=" + doc1));
        rejects("FK-DELETE-PATIENT-BLOCKED", 1451, () -> execute("DELETE FROM patients WHERE id=" + pat1));
        rejects("FK-DELETE-SCHEDULE-BLOCKED", 1451, () -> execute("DELETE FROM doctor_schedules WHERE id=" + sch1));
        rejects("FK-DELETE-CREATOR-BLOCKED", 1451, () -> execute("DELETE FROM users WHERE id=" + uPatient1));

        // 12. EXPLAIN query verification using indexes
        check("EXPLAIN-APPOINTMENT-PK", rows("EXPLAIN SELECT * FROM appointments WHERE id=" + appAdjacent).get(0).contains("PRIMARY"));
        check("EXPLAIN-DOCTOR-TIME-STATUS", rows("EXPLAIN SELECT * FROM appointments WHERE doctor_id=" + doc1
                + " AND start_at_utc >= '2026-11-25 00:00:00' AND status='PENDING'").get(0).contains("ix_appointments_doctor_time_status"));
        check("EXPLAIN-PATIENT-START-ID", rows("EXPLAIN SELECT * FROM appointments WHERE patient_id=" + pat1
                + " AND start_at_utc >= '2026-11-25 00:00:00' ORDER BY start_at_utc, id").get(0).contains("ix_appointments_patient_start_id"));
        check("EXPLAIN-STATUS-START-ID", rows("EXPLAIN SELECT * FROM appointments WHERE status='PENDING' "
                + "AND start_at_utc >= '2026-11-25 00:00:00' ORDER BY start_at_utc, id").get(0).contains("ix_appointments_status_start_id"));

        // Rollback verification
        db.rollback();
        db.setAutoCommit(true);
        check("DATA-ROLLBACK-CLEAN", count("SELECT COUNT(*) FROM appointments") == 0);
    }

    /**
     * Multithreaded concurrent booking test:
     * Simulates two patients attempting to book the exact same slot concurrently.
     * Both threads execute the project's transactional protocol:
     * 1. Lock parent doctor row (PESSIMISTIC_WRITE): SELECT id FROM doctors WHERE id = ? FOR UPDATE.
     * 2. Check active slot availability (or let database unique active slot constraint enforce).
     * 3. Insert appointment, commit.
     * Proves: Exactly one thread succeeds, the competing thread detects conflict and rolls back cleanly.
     */
    static void concurrentBookingTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(780, "DOCTOR");
        long uP1 = insertUser(781, "PATIENT");
        long uP2 = insertUser(782, "PATIENT");

        long spec = specialty("D07_CONC_SPEC", "Concurrency Spec");
        long docId = doctor(uDoc, spec, "D07_CONC_DR", "LIC_CONC_1");
        long patId1 = patient(uP1, "D07_CONC_P1", "Conc Patient 1");
        long patId2 = patient(uP2, "D07_CONC_P2", "Conc Patient 2");
        long schId = schedule(docId, "2026-11-26", "2026-11-26 02:00:00.000000", "2026-11-26 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        String targetSlot = "2026-11-26 02:00:00.000000";
        String targetEnd = "2026-11-26 02:30:00.000000";

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean thread1Success = new AtomicBoolean(false);
        AtomicBoolean thread2Success = new AtomicBoolean(false);
        AtomicBoolean thread2ConflictDetected = new AtomicBoolean(false);

        // Thread 1: Patient 1 attempts booking slot 02:00
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                // 1. Lock doctor
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                // Sleep briefly to simulate work under lock
                Thread.sleep(300);
                // 2. Check active slot
                String checkSql = "SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND active_slot_start_utc = ?";
                try (var s = conn.prepareStatement(checkSql)) {
                    s.setLong(1, docId);
                    s.setTimestamp(2, Timestamp.valueOf(targetSlot));
                    var rs = s.executeQuery();
                    rs.next();
                    if (rs.getLong(1) == 0) {
                        String insertSql = "INSERT INTO appointments(appointment_code, patient_id, doctor_id, schedule_id, created_by, "
                                + "start_at_utc, end_at_utc, status, reason, request_key, request_fingerprint, version, created_at, updated_at) "
                                + "VALUES ('APP-CONC-01', ?, ?, ?, ?, ?, ?, 'PENDING', 'P1 booking', 'req-conc-01', ?, 0, " + NOW + ", " + NOW + ")";
                        try (var ins = conn.prepareStatement(insertSql)) {
                            ins.setLong(1, patId1);
                            ins.setLong(2, docId);
                            ins.setLong(3, schId);
                            ins.setLong(4, uP1);
                            ins.setTimestamp(5, Timestamp.valueOf(targetSlot));
                            ins.setTimestamp(6, Timestamp.valueOf(targetEnd));
                            ins.setString(7, fp);
                            ins.executeUpdate();
                        }
                        conn.commit();
                        thread1Success.set(true);
                    } else {
                        conn.rollback();
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                doneLatch.countDown();
            }
        });

        // Thread 2: Patient 2 attempts booking same slot 02:00
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(50); // slight stagger so Thread 1 locks first
                // 1. Lock doctor (will block until Thread 1 commits)
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                // 2. Check active slot (sees Thread 1's committed appointment)
                String checkSql = "SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND active_slot_start_utc = ?";
                try (var s = conn.prepareStatement(checkSql)) {
                    s.setLong(1, docId);
                    s.setTimestamp(2, Timestamp.valueOf(targetSlot));
                    var rs = s.executeQuery();
                    rs.next();
                    if (rs.getLong(1) == 0) {
                        String insertSql = "INSERT INTO appointments(appointment_code, patient_id, doctor_id, schedule_id, created_by, "
                                + "start_at_utc, end_at_utc, status, reason, request_key, request_fingerprint, version, created_at, updated_at) "
                                + "VALUES ('APP-CONC-02', ?, ?, ?, ?, ?, ?, 'PENDING', 'P2 booking', 'req-conc-02', ?, 0, " + NOW + ", " + NOW + ")";
                        try (var ins = conn.prepareStatement(insertSql)) {
                            ins.setLong(1, patId2);
                            ins.setLong(2, docId);
                            ins.setLong(3, schId);
                            ins.setLong(4, uP2);
                            ins.setTimestamp(5, Timestamp.valueOf(targetSlot));
                            ins.setTimestamp(6, Timestamp.valueOf(targetEnd));
                            ins.setString(7, fp);
                            ins.executeUpdate();
                        }
                        conn.commit();
                        thread2Success.set(true);
                    } else {
                        // Conflict detected!
                        thread2ConflictDetected.set(true);
                        conn.rollback();
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                doneLatch.countDown();
            }
        });

        startLatch.countDown();
        boolean completed = doneLatch.await(10, TimeUnit.SECONDS);
        pool.shutdown();

        check("CONCURRENT-BOOKING-COMPLETED", completed);
        check("CONCURRENT-THREAD-1-COMMITTED", thread1Success.get());
        check("CONCURRENT-THREAD-2-CONFLICT-DETECTED", thread2ConflictDetected.get());
        check("CONCURRENT-THREAD-2-BLOCKED-FROM-INSERT", !thread2Success.get());
        check("CONCURRENT-EXACTLY-ONE-APPOINTMENT-PERSISTED",
                count("SELECT COUNT(*) FROM appointments WHERE doctor_id=" + docId + " AND appointment_code LIKE 'APP-CONC-%'") == 1);
    }

    /**
     * Concurrent booking vs D06 schedule modification test:
     * Verifies that schedule modification and appointment booking serialize cleanly
     * on the parent doctor row lock without deadlocks.
     */
    static void concurrentBookingVsScheduleShiftTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(790, "DOCTOR");
        long uP = insertUser(791, "PATIENT");

        long spec = specialty("D07_SCHED_SPEC", "Schedule Spec");
        long docId = doctor(uDoc, spec, "D07_SCHED_DR", "LIC_SCHED_1");
        long patId = patient(uP, "D07_SCHED_P", "Sched Patient");
        long schId = schedule(docId, "2026-11-27", "2026-11-27 01:00:00.000000", "2026-11-27 05:00:00.000000", 30, "ACTIVE");

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean bookingDone = new AtomicBoolean(false);
        AtomicBoolean scheduleUpdateDone = new AtomicBoolean(false);

        // Thread 1: Update schedule status to BLOCKED under doctor lock
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                Thread.sleep(200);
                try (var s = conn.prepareStatement("UPDATE doctor_schedules SET status = 'BLOCKED', version = version + 1 WHERE id = ?")) {
                    s.setLong(1, schId);
                    s.executeUpdate();
                }
                conn.commit();
                scheduleUpdateDone.set(true);
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                doneLatch.countDown();
            }
        });

        // Thread 2: Attempt booking under doctor lock
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(50);
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                // Verify schedule status seen after lock
                try (var s = conn.prepareStatement("SELECT status FROM doctor_schedules WHERE id = ?")) {
                    s.setLong(1, schId);
                    var rs = s.executeQuery();
                    rs.next();
                    String status = rs.getString(1);
                    // Schedule is now BLOCKED, so booking logic rejects the request cleanly
                    if ("BLOCKED".equals(status)) {
                        conn.rollback();
                        bookingDone.set(true);
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                doneLatch.countDown();
            }
        });

        startLatch.countDown();
        boolean completed = doneLatch.await(10, TimeUnit.SECONDS);
        pool.shutdown();

        check("CONCURRENT-SCHEDULE-VS-BOOKING-COMPLETED", completed);
        check("CONCURRENT-SCHEDULE-UPDATE-SUCCESS", scheduleUpdateDone.get());
        check("CONCURRENT-BOOKING-SEES-BLOCKED-SCHEDULE", bookingDone.get());
    }

    public static void main(String[] args) throws Exception {
        if (!env("CLINIC_QA_ACK").equals("NEW_D07_INSTANCE_ONLY")) {
            throw new IllegalStateException("New isolated QA instance required");
        }
        String url = env("DB_URL"), fresh = env("DB_FRESH_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_management_db(?:\\?.*)?") || url.contains(":3307/") || url.contains(":3306/")
                || !fresh.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_d02_be_it_d07_[a-z0-9]+(?:\\?.*)?")) {
            throw new IllegalStateException("Unexpected D07 QA URL: " + url);
        }

        try (var connection = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
            db = connection;
            check("MYSQL-8.4", db.getMetaData().getDatabaseProductVersion().startsWith("8.4."));
            check("UPGRADE-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);

            // Step 1: Flyway V1
            var v1 = flyway(url, args[0], "1");
            check("UPGRADE-V1-APPLIED", v1.migrate().migrationsExecuted == 1);
            execute("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) "
                    + "VALUES ('d07-preserve@example.test','synthetic-preserve-fixture','QA Preserved User','PATIENT','ACTIVE'," + NOW + "," + NOW + ")");
            String v1History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'");

            // Step 2: Flyway V2
            var v2 = flyway(url, args[0], "2");
            check("UPGRADE-V2-APPLIED", v2.migrate().migrationsExecuted == 1);
            execute("INSERT INTO specialties(code,name,created_at,updated_at) VALUES ('QA_CARD_D07','Cardiology D07'," + NOW + "," + NOW + ")");
            String v2History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V2", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));

            // Step 3: Flyway V3
            var v3 = flyway(url, args[0], "3");
            check("UPGRADE-V3-APPLIED", v3.migrate().migrationsExecuted == 1);
            String v3History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V3", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V3", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));

            // Step 4: Flyway V4
            var v4 = flyway(url, args[0], "4");
            check("UPGRADE-V4-APPLIED", v4.migrate().migrationsExecuted == 1);
            String v4History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='4'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V4", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V4", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V4", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));

            // Step 5: Flyway V5
            var v5 = flyway(url, args[0], "5");
            check("UPGRADE-V5-APPLIED", v5.migrate().migrationsExecuted == 1);
            String v5History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='5'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V5", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V5", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V5", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));
            check("UPGRADE-V4-HISTORY-UNCHANGED-AFTER-V5", v4History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='4'")));

            // Step 6: Flyway V6
            var all = flyway(url, args[0], null);
            check("UPGRADE-V6-APPLIED", all.migrate().migrationsExecuted == 1);
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V6", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V6", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V6", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));
            check("UPGRADE-V4-HISTORY-UNCHANGED-AFTER-V6", v4History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='4'")));
            check("UPGRADE-V5-HISTORY-UNCHANGED-AFTER-V6", v5History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='5'")));

            // Validation & Idempotency
            check("UPGRADE-VALIDATE", all.validateWithResult().validationSuccessful);
            List<String> history = rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank");
            check("UPGRADE-REPEAT-NOOP", all.migrate().migrationsExecuted == 0
                    && history.equals(rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank")));
            check("UPGRADE-CURRENT-V6", all.info().current().getVersion().getVersion().equals("6") && all.info().applied().length == 6);

            System.out.println("V6_FLYWAY_CHECKSUM=" + scalar("SELECT checksum FROM flyway_schema_history WHERE version='6'"));

            schemaChecks();
            dataChecks();
            concurrentBookingTest(url);
            concurrentBookingVsScheduleShiftTest(url);

            // Fresh database test (V1 + V2 + V3 + V4 + V5 + V6 in one go)
            try (var freshConnection = DriverManager.getConnection(fresh, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                db = freshConnection;
                check("FRESH-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);
                var f = flyway(fresh, args[0], null);
                check("FRESH-APPLY-V1-TO-V6", f.migrate().migrationsExecuted == 6);
                check("FRESH-VALIDATE", f.validateWithResult().validationSuccessful);
                schemaChecks();
                check("FRESH-NO-APPOINTMENTS-SEED", count("SELECT COUNT(*) FROM appointments") == 0);
                check("FRESH-NO-SCHEDULES-SEED", count("SELECT COUNT(*) FROM doctor_schedules") == 0);
                check("FRESH-NO-USERS-SEED", count("SELECT COUNT(*) FROM users") == 0);
                check("FRESH-REPEAT-NOOP", f.migrate().migrationsExecuted == 0);
            }
        }

        System.out.println("D07_SUMMARY passed=" + passed + " failed=0 skipped=0");
    }
}
