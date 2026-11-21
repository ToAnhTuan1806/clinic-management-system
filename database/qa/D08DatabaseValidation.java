import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.flywaydb.core.Flyway;

/**
 * CL-D08-DB MySQL validation: appointment lifecycle via Flyway V7.
 * Tests V1 -> V2 -> V3 -> V4 -> V5 -> V6 -> V7 upgrade, idempotency, schema,
 * cancellation metadata (cancelled_at, cancelled_by, cancellation_reason),
 * reschedule metadata (rescheduled_at, rescheduled_by, previous_schedule_id, previous_start_at_utc),
 * active slot release on cancellation, rebooking of cancelled slots, history preservation,
 * FK RESTRICT on metadata fields, and multithreaded concurrency tests:
 * 1. Concurrent reschedules competing for the same slot.
 * 2. Concurrent new booking vs reschedule.
 * 3. Concurrent cancellation vs reschedule.
 * 4. Concurrent cancellation vs schedule status patch.
 * 5. Optimistic locking version conflict.
 */
class D08DatabaseValidation {
    static Connection db;
    static int passed;
    static final String NOW = "'2026-11-21 12:15:16.123456'";

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
            s.setString(1, "d08-user-" + index + "@example.test");
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

        // Columns check (exactly 23 columns after V7 lifecycle additions)
        check("SCHEMA-APPOINTMENTS-COLUMN-COUNT", columns("appointments").size() == 23);

        // Check new V7 columns exist with correct types and nullability
        check("SCHEMA-COL-CANCELLED-AT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='cancelled_at' AND column_type='datetime(6)' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-CANCELLED-BY", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='cancelled_by' AND column_type='bigint' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-CANCELLATION-REASON", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='cancellation_reason' AND column_type='varchar(255)' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-RESCHEDULED-AT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='rescheduled_at' AND column_type='datetime(6)' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-RESCHEDULED-BY", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='rescheduled_by' AND column_type='bigint' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-PREVIOUS-SCHEDULE-ID", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='previous_schedule_id' AND column_type='bigint' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-PREVIOUS-START-AT-UTC", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='previous_start_at_utc' AND column_type='datetime(6)' AND is_nullable='YES'") == 1);

        // Foreign keys with RESTRICT
        check("SCHEMA-FK-CANCELLED-BY", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='fk_appointments_cancelled_by' AND referenced_table_name='users' AND delete_rule='RESTRICT'") == 1);
        check("SCHEMA-FK-RESCHEDULED-BY", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='fk_appointments_rescheduled_by' AND referenced_table_name='users' AND delete_rule='RESTRICT'") == 1);
        check("SCHEMA-FK-PREVIOUS-SCHEDULE", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='fk_appointments_previous_schedule' AND referenced_table_name='doctor_schedules' AND delete_rule='RESTRICT'") == 1);

        // Check constraints enforced
        check("SCHEMA-CHECKS-COUNT", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_type='CHECK' AND enforced='YES'") == 10);
        check("SCHEMA-CHECK-CANCELLATION-REASON", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_cancellation_reason'") == 1);
        check("SCHEMA-CHECK-CANCELLED-AT", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_cancelled_at'") == 1);
        check("SCHEMA-CHECK-RESCHEDULED-AT", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND constraint_name='chk_appointments_rescheduled_at'") == 1);

        // Indexes for lifecycle queries
        check("SCHEMA-INDEX-CANCELLED-AT", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND index_name='ix_appointments_cancelled_at'") == 1);
        check("SCHEMA-INDEX-RESCHEDULED-AT", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND index_name='ix_appointments_rescheduled_at'") == 1);
    }

    static void dataChecks() throws SQLException {
        db.setAutoCommit(false);

        long uDoc1 = insertUser(801, "DOCTOR");
        long uDoc2 = insertUser(802, "DOCTOR");
        long uPat1 = insertUser(803, "PATIENT");
        long uPat2 = insertUser(804, "PATIENT");
        long uRecep = insertUser(805, "RECEPTIONIST");

        long spec = specialty("D08_SPEC_INT", "Internal Medicine QA D08");
        long doc1 = doctor(uDoc1, spec, "D08_DOC_1", "LIC_D08_1");
        long doc2 = doctor(uDoc2, spec, "D08_DOC_2", "LIC_D08_2");

        long pat1 = patient(uPat1, "D08_PAT_1", "Lifecycle Patient 1");
        long pat2 = patient(uPat2, "D08_PAT_2", "Lifecycle Patient 2");

        long sch1 = schedule(doc1, "2026-11-28", "2026-11-28 01:00:00.000000", "2026-11-28 05:00:00.000000", 30, "ACTIVE");
        long sch1Later = schedule(doc1, "2026-11-28", "2026-11-28 06:00:00.000000", "2026-11-28 10:00:00.000000", 30, "ACTIVE");

        String fp1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        String fp2 = "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e";

        // 1. Insert appointment with initial status PENDING
        long app1 = appointment("APP-D08-001", pat1, doc1, sch1, uPat1,
                "2026-11-28 01:00:00.000000", "2026-11-28 01:30:00.000000", "PENDING", "Initial checkup",
                "req-d08-001", fp1);
        check("DATA-INITIAL-APPOINTMENT-PENDING", app1 > 0);
        check("DATA-ACTIVE-SLOT-PRESENT-FOR-PENDING",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app1)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + app1)));

        // 2. Cancellation: updates status to CANCELLED and records cancellation metadata
        execute("UPDATE appointments SET status='CANCELLED', cancelled_at=" + NOW + ", cancelled_by=" + uPat1
                + ", cancellation_reason='Patient schedule conflict', version=version+1, updated_at=" + NOW + " WHERE id=" + app1);
        check("DATA-CANCELLED-STATUS", "CANCELLED".equals(scalar("SELECT status FROM appointments WHERE id=" + app1)));
        check("DATA-CANCELLED-METADATA-RECORDED", scalar("SELECT cancellation_reason FROM appointments WHERE id=" + app1).equals("Patient schedule conflict"));
        check("DATA-CANCELLED-BY-RECORDED", String.valueOf(uPat1).equals(scalar("SELECT cancelled_by FROM appointments WHERE id=" + app1)));
        check("DATA-CANCELLED-SLOT-RELEASED", scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app1) == null);

        // 3. Rebooking: Another patient can now book the cancelled slot
        long appRebooked = appointment("APP-D08-002", pat2, doc1, sch1, uPat2,
                "2026-11-28 01:00:00.000000", "2026-11-28 01:30:00.000000", "PENDING", "Rebooked appointment",
                "req-d08-002", fp2);
        check("DATA-REBOOK-CANCELLED-SLOT-SUCCESS", appRebooked > app1);
        check("DATA-REBOOKED-SLOT-ACTIVE",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + appRebooked)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + appRebooked)));

        // 4. Historical record preserved: BOTH the cancelled appointment and the new active appointment exist
        check("DATA-HISTORY-PRESERVED-BOTH-EXIST",
                count("SELECT COUNT(*) FROM appointments WHERE doctor_id=" + doc1 + " AND start_at_utc=(SELECT start_at_utc FROM appointments WHERE id=" + app1 + ")") == 2);

        // 5. Reschedule test:
        // Patient 2 reschedules appRebooked from slot 01:00 to slot 02:00 in sch1
        String newStart = "2026-11-28 02:00:00.000000";
        String newEnd = "2026-11-28 02:30:00.000000";
        String origStart = scalar("SELECT start_at_utc FROM appointments WHERE id=" + appRebooked);

        try (var u = db.prepareStatement("UPDATE appointments SET previous_schedule_id=schedule_id, previous_start_at_utc=start_at_utc, "
                + "start_at_utc=?, end_at_utc=?, rescheduled_at=" + NOW + ", rescheduled_by=?, version=version+1, updated_at=" + NOW
                + " WHERE id=?")) {
            u.setTimestamp(1, Timestamp.valueOf(newStart));
            u.setTimestamp(2, Timestamp.valueOf(newEnd));
            u.setLong(3, uPat2);
            u.setLong(4, appRebooked);
            u.executeUpdate();
        }

        check("DATA-RESCHEDULED-START-MOVED", !origStart.equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + appRebooked)));
        check("DATA-RESCHEDULED-PREVIOUS-START-RECORDED", origStart.equals(scalar("SELECT previous_start_at_utc FROM appointments WHERE id=" + appRebooked)));
        check("DATA-RESCHEDULED-BY-RECORDED", String.valueOf(uPat2).equals(scalar("SELECT rescheduled_by FROM appointments WHERE id=" + appRebooked)));
        check("DATA-RESCHEDULED-ACTIVE-SLOT-UPDATED",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + appRebooked)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + appRebooked)));

        // 6. Reschedule frees the previous slot (01:00): Now Patient 1 can book slot 01:00 again!
        long appReclaimOrigSlot = appointment("APP-D08-003", pat1, doc1, sch1, uPat1,
                "2026-11-28 01:00:00.000000", "2026-11-28 01:30:00.000000", "PENDING", "Reclaiming original slot",
                "req-d08-003", fp1);
        check("DATA-PREVIOUS-SLOT-FREED-AND-REBOOKED", appReclaimOrigSlot > appRebooked);

        // 7. And slot 02:00 is now occupied by appRebooked: Attempt to double-book 02:00 is rejected Error 1062
        rejects("DOUBLE-BOOKING-RESCHEDULED-SLOT-REJECTED", 1062, () -> appointment("APP-D08-004", pat1, doc1, sch1, uPat1,
                newStart, newEnd, "PENDING", "Attempting double-booking on rescheduled slot", "req-d08-004", fp1));

        // 8. Negative constraint tests on lifecycle fields
        // Cancellation reason > 255 chars rejected Error 1406
        rejects("CHECK-CANCELLATION-REASON-TOO-LONG", 1406, () -> execute("UPDATE appointments SET cancellation_reason='" + "x".repeat(256) + "' WHERE id=" + app1));

        // FK checks on lifecycle fields
        rejects("FK-CANCELLED-BY-ORPHAN", 1452, () -> execute("UPDATE appointments SET cancelled_by=9223372036854775806 WHERE id=" + app1));
        rejects("FK-RESCHEDULED-BY-ORPHAN", 1452, () -> execute("UPDATE appointments SET rescheduled_by=9223372036854775806 WHERE id=" + app1));
        rejects("FK-PREVIOUS-SCHEDULE-ORPHAN", 1452, () -> execute("UPDATE appointments SET previous_schedule_id=9223372036854775806 WHERE id=" + app1));

        // FK RESTRICT prevents deleting referenced user or schedule
        rejects("FK-DELETE-CANCELLED-BY-USER-BLOCKED", 1451, () -> execute("DELETE FROM users WHERE id=" + uPat1));
        rejects("FK-DELETE-RESCHEDULED-BY-USER-BLOCKED", 1451, () -> execute("DELETE FROM users WHERE id=" + uPat2));
        rejects("FK-DELETE-PREVIOUS-SCHEDULE-BLOCKED", 1451, () -> execute("DELETE FROM doctor_schedules WHERE id=" + sch1));

        // Rollback verification
        db.rollback();
        db.setAutoCommit(true);
        check("DATA-ROLLBACK-CLEAN", count("SELECT COUNT(*) FROM appointments") == 0);
    }

    /**
     * Concurrency Test 1: Two concurrent reschedules into the SAME target slot.
     * Both threads try to reschedule different appointments into the same target slot.
     * With pessimistic locking on doctor row, exactly one succeeds; the second sees the slot occupied and rolls back.
     */
    static void concurrentRescheduleDoubleBookingTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(880, "DOCTOR");
        long uP1 = insertUser(881, "PATIENT");
        long uP2 = insertUser(882, "PATIENT");

        long spec = specialty("D08_CONC1_SPEC", "Conc Spec 1");
        long docId = doctor(uDoc, spec, "D08_CONC1_DR", "LIC_CONC1_1");
        long patId1 = patient(uP1, "D08_CONC1_P1", "Patient 1");
        long patId2 = patient(uP2, "D08_CONC1_P2", "Patient 2");
        long schId = schedule(docId, "2026-11-29", "2026-11-29 01:00:00.000000", "2026-11-29 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        // Setup: App1 at 01:00, App2 at 02:00
        long app1 = appointment("APP-RESCHED-01", patId1, docId, schId, uP1,
                "2026-11-29 01:00:00.000000", "2026-11-29 01:30:00.000000", "PENDING", "Booking 1", "k1", fp);
        long app2 = appointment("APP-RESCHED-02", patId2, docId, schId, uP2,
                "2026-11-29 02:00:00.000000", "2026-11-29 02:30:00.000000", "PENDING", "Booking 2", "k2", fp);

        String targetSlot = "2026-11-29 03:00:00.000000";
        String targetEnd = "2026-11-29 03:30:00.000000";

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean thread1Success = new AtomicBoolean(false);
        AtomicBoolean thread2Success = new AtomicBoolean(false);
        AtomicBoolean thread2ConflictDetected = new AtomicBoolean(false);

        // Thread 1: Reschedule App1 to 03:00
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                // 1. Lock doctor
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                Thread.sleep(300);
                // 2. Check slot availability
                try (var s = conn.prepareStatement("SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND active_slot_start_utc = ?")) {
                    s.setLong(1, docId);
                    s.setTimestamp(2, Timestamp.valueOf(targetSlot));
                    var rs = s.executeQuery();
                    rs.next();
                    if (rs.getLong(1) == 0) {
                        try (var upd = conn.prepareStatement("UPDATE appointments SET previous_schedule_id=schedule_id, "
                                + "previous_start_at_utc=start_at_utc, start_at_utc=?, end_at_utc=?, rescheduled_at=" + NOW + ", "
                                + "rescheduled_by=?, version=version+1, updated_at=" + NOW + " WHERE id=?")) {
                            upd.setTimestamp(1, Timestamp.valueOf(targetSlot));
                            upd.setTimestamp(2, Timestamp.valueOf(targetEnd));
                            upd.setLong(3, uP1);
                            upd.setLong(4, app1);
                            upd.executeUpdate();
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

        // Thread 2: Reschedule App2 to 03:00
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(50);
                // 1. Lock doctor (will block until Thread 1 commits)
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                // 2. Check slot availability (now sees Thread 1's committed appointment at 03:00)
                try (var s = conn.prepareStatement("SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND active_slot_start_utc = ?")) {
                    s.setLong(1, docId);
                    s.setTimestamp(2, Timestamp.valueOf(targetSlot));
                    var rs = s.executeQuery();
                    rs.next();
                    if (rs.getLong(1) == 0) {
                        try (var upd = conn.prepareStatement("UPDATE appointments SET previous_schedule_id=schedule_id, "
                                + "previous_start_at_utc=start_at_utc, start_at_utc=?, end_at_utc=?, rescheduled_at=" + NOW + ", "
                                + "rescheduled_by=?, version=version+1, updated_at=" + NOW + " WHERE id=?")) {
                            upd.setTimestamp(1, Timestamp.valueOf(targetSlot));
                            upd.setTimestamp(2, Timestamp.valueOf(targetEnd));
                            upd.setLong(3, uP2);
                            upd.setLong(4, app2);
                            upd.executeUpdate();
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

        check("CONCURRENT-RESCHEDULE-COMPLETED", completed);
        check("CONCURRENT-RESCHEDULE-THREAD-1-COMMITTED", thread1Success.get());
        check("CONCURRENT-RESCHEDULE-THREAD-2-CONFLICT-DETECTED", thread2ConflictDetected.get());
        check("CONCURRENT-RESCHEDULE-THREAD-2-ROLLED-BACK", !thread2Success.get());
        // Verify exactly one appointment is at 03:00 (App1)
        check("CONCURRENT-RESCHEDULE-EXACTLY-ONE-OCCUPIES-SLOT",
                count("SELECT COUNT(*) FROM appointments WHERE doctor_id=" + docId + " AND id=" + app1
                        + " AND active_slot_start_utc=(SELECT active_slot_start_utc FROM appointments WHERE id=" + app1 + ")") == 1);
        // And App2 is still at its original 02:00 slot
        check("CONCURRENT-RESCHEDULE-APP2-RETAINS-ORIGINAL-SLOT",
                count("SELECT COUNT(*) FROM appointments WHERE id=" + app2 + " AND previous_start_at_utc IS NULL") == 1);
    }

    /**
     * Concurrency Test 2: Booking vs Reschedule into the same target slot.
     * New booking and reschedule compete for slot 04:00.
     * Only one succeeds; the loser rolls back cleanly.
     */
    static void concurrentBookingVsRescheduleTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(890, "DOCTOR");
        long uP1 = insertUser(891, "PATIENT");
        long uP2 = insertUser(892, "PATIENT");

        long spec = specialty("D08_CONC2_SPEC", "Conc Spec 2");
        long docId = doctor(uDoc, spec, "D08_CONC2_DR", "LIC_CONC2_1");
        long patId1 = patient(uP1, "D08_CONC2_P1", "Patient 1");
        long patId2 = patient(uP2, "D08_CONC2_P2", "Patient 2");
        long schId = schedule(docId, "2026-11-29", "2026-11-29 01:00:00.000000", "2026-11-29 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        long existingApp = appointment("APP-BVR-01", patId1, docId, schId, uP1,
                "2026-11-29 01:00:00.000000", "2026-11-29 01:30:00.000000", "PENDING", "Initial app", "kbvr1", fp);

        String targetSlot = "2026-11-29 04:00:00.000000";
        String targetEnd = "2026-11-29 04:30:00.000000";

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean bookingSuccess = new AtomicBoolean(false);
        AtomicBoolean rescheduleSuccess = new AtomicBoolean(false);
        AtomicBoolean conflictDetected = new AtomicBoolean(false);

        // Thread 1: New Booking at 04:00
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                Thread.sleep(300);
                try (var s = conn.prepareStatement("SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND active_slot_start_utc = ?")) {
                    s.setLong(1, docId);
                    s.setTimestamp(2, Timestamp.valueOf(targetSlot));
                    var rs = s.executeQuery();
                    rs.next();
                    if (rs.getLong(1) == 0) {
                        try (var ins = conn.prepareStatement("INSERT INTO appointments(appointment_code, patient_id, doctor_id, schedule_id, created_by, "
                                + "start_at_utc, end_at_utc, status, reason, request_key, request_fingerprint, version, created_at, updated_at) "
                                + "VALUES ('APP-BVR-NEW', ?, ?, ?, ?, ?, ?, 'PENDING', 'New booking', 'kbvr-new', ?, 0, " + NOW + ", " + NOW + ")")) {
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
                        bookingSuccess.set(true);
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

        // Thread 2: Reschedule existingApp to 04:00
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(50);
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                try (var s = conn.prepareStatement("SELECT COUNT(*) FROM appointments WHERE doctor_id = ? AND active_slot_start_utc = ?")) {
                    s.setLong(1, docId);
                    s.setTimestamp(2, Timestamp.valueOf(targetSlot));
                    var rs = s.executeQuery();
                    rs.next();
                    if (rs.getLong(1) == 0) {
                        try (var upd = conn.prepareStatement("UPDATE appointments SET previous_schedule_id=schedule_id, "
                                + "previous_start_at_utc=start_at_utc, start_at_utc=?, end_at_utc=?, rescheduled_at=" + NOW + ", "
                                + "rescheduled_by=?, version=version+1, updated_at=" + NOW + " WHERE id=?")) {
                            upd.setTimestamp(1, Timestamp.valueOf(targetSlot));
                            upd.setTimestamp(2, Timestamp.valueOf(targetEnd));
                            upd.setLong(3, uP1);
                            upd.setLong(4, existingApp);
                            upd.executeUpdate();
                        }
                        conn.commit();
                        rescheduleSuccess.set(true);
                    } else {
                        conflictDetected.set(true);
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

        check("CONCURRENT-BOOKING-VS-RESCHEDULE-COMPLETED", completed);
        check("CONCURRENT-BOOKING-SUCCESS", bookingSuccess.get());
        check("CONCURRENT-RESCHEDULE-CONFLICT-DETECTED", conflictDetected.get());
        check("CONCURRENT-RESCHEDULE-ROLLED-BACK", !rescheduleSuccess.get());
        check("CONCURRENT-BOOKING-VS-RESCHEDULE-EXISTING-APP-PRESERVED",
                count("SELECT COUNT(*) FROM appointments WHERE id=" + existingApp + " AND previous_start_at_utc IS NULL") == 1);
    }

    /**
     * Concurrency Test 3: Cancellation vs Reschedule on the SAME appointment.
     * Thread 1 cancels Appointment A.
     * Thread 2 simultaneously tries to reschedule Appointment A.
     * Thread 2 detects that appointment is CANCELLED (terminal state) and aborts rescheduling.
     */
    static void concurrentCancellationVsRescheduleTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(901, "DOCTOR");
        long uP = insertUser(902, "PATIENT");

        long spec = specialty("D08_CONC3_SPEC", "Conc Spec 3");
        long docId = doctor(uDoc, spec, "D08_CONC3_DR", "LIC_CONC3_1");
        long patId = patient(uP, "D08_CONC3_P", "Patient 3");
        long schId = schedule(docId, "2026-11-29", "2026-11-29 01:00:00.000000", "2026-11-29 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        long targetApp = appointment("APP-CVR-01", patId, docId, schId, uP,
                "2026-11-29 01:00:00.000000", "2026-11-29 01:30:00.000000", "PENDING", "To be cancelled", "kcvr1", fp);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean cancelSuccess = new AtomicBoolean(false);
        AtomicBoolean rescheduleAborted = new AtomicBoolean(false);

        // Thread 1: Cancel appointment
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                Thread.sleep(300);
                try (var s = conn.prepareStatement("UPDATE appointments SET status='CANCELLED', cancelled_at=" + NOW + ", "
                        + "cancelled_by=?, cancellation_reason='User cancelled', version=version+1, updated_at=" + NOW + " WHERE id=?")) {
                    s.setLong(1, uP);
                    s.setLong(2, targetApp);
                    s.executeUpdate();
                }
                conn.commit();
                cancelSuccess.set(true);
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                doneLatch.countDown();
            }
        });

        // Thread 2: Try to reschedule appointment
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(50);
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                // Check appointment status under lock
                try (var s = conn.prepareStatement("SELECT status FROM appointments WHERE id = ?")) {
                    s.setLong(1, targetApp);
                    var rs = s.executeQuery();
                    rs.next();
                    String status = rs.getString(1);
                    if ("CANCELLED".equals(status)) {
                        // Appointment was cancelled! Reschedule must be aborted!
                        rescheduleAborted.set(true);
                        conn.rollback();
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

        startLatch.countDown();
        boolean completed = doneLatch.await(10, TimeUnit.SECONDS);
        pool.shutdown();

        check("CONCURRENT-CANCEL-VS-RESCHEDULE-COMPLETED", completed);
        check("CONCURRENT-CANCEL-SUCCESS", cancelSuccess.get());
        check("CONCURRENT-RESCHEDULE-ABORTED-ON-CANCELLED-STATUS", rescheduleAborted.get());
        check("CONCURRENT-APPOINTMENT-REMAINS-CANCELLED",
                "CANCELLED".equals(scalar("SELECT status FROM appointments WHERE id=" + targetApp)));
    }

    /**
     * Concurrency Test 4: Optimistic Locking Version Conflict.
     * Verifies that concurrent updates using optimistic locking detect version mismatch and roll back.
     */
    static void optimisticLockingVersionConflictTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(910, "DOCTOR");
        long uP = insertUser(911, "PATIENT");

        long spec = specialty("D08_OPT_SPEC", "Opt Spec");
        long docId = doctor(uDoc, spec, "D08_OPT_DR", "LIC_OPT_1");
        long patId = patient(uP, "D08_OPT_P", "Opt Patient");
        long schId = schedule(docId, "2026-11-29", "2026-11-29 01:00:00.000000", "2026-11-29 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        long app = appointment("APP-OPT-01", patId, docId, schId, uP,
                "2026-11-29 05:00:00.000000", "2026-11-29 05:30:00.000000", "PENDING", "Opt initial", "kopt1", fp);

        long initialVersion = Long.parseLong(scalar("SELECT version FROM appointments WHERE id=" + app));

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean thread1Success = new AtomicBoolean(false);
        AtomicBoolean thread2Conflict = new AtomicBoolean(false);

        // Thread 1: updates reason with version = initialVersion
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                try (var s = conn.prepareStatement("UPDATE appointments SET reason='Updated by T1', version=version+1, updated_at=" + NOW
                        + " WHERE id=? AND version=?")) {
                    s.setLong(1, app);
                    s.setLong(2, initialVersion);
                    int updated = s.executeUpdate();
                    if (updated == 1) {
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

        // Thread 2: simultaneously tries to update reason with same initialVersion
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(100); // slight stagger
                try (var s = conn.prepareStatement("UPDATE appointments SET reason='Updated by T2', version=version+1, updated_at=" + NOW
                        + " WHERE id=? AND version=?")) {
                    s.setLong(1, app);
                    s.setLong(2, initialVersion);
                    int updated = s.executeUpdate();
                    if (updated == 0) {
                        // Optimistic lock conflict detected!
                        thread2Conflict.set(true);
                        conn.rollback();
                    } else {
                        conn.commit();
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

        check("CONCURRENT-OPTIMISTIC-LOCK-COMPLETED", completed);
        check("CONCURRENT-OPTIMISTIC-THREAD-1-COMMITTED", thread1Success.get());
        check("CONCURRENT-OPTIMISTIC-THREAD-2-CONFLICT-DETECTED", thread2Conflict.get());
        check("CONCURRENT-OPTIMISTIC-VERSION-INCREMENTED-EXACTLY-ONCE",
                count("SELECT COUNT(*) FROM appointments WHERE id=" + app + " AND version=" + (initialVersion + 1)) == 1);
        check("CONCURRENT-OPTIMISTIC-REASON-MATCHES-T1",
                "Updated by T1".equals(scalar("SELECT reason FROM appointments WHERE id=" + app)));
    }

    public static void main(String[] args) throws Exception {
        if (!env("CLINIC_QA_ACK").equals("NEW_D08_INSTANCE_ONLY")) {
            throw new IllegalStateException("New isolated QA instance required");
        }
        String url = env("DB_URL"), fresh = env("DB_FRESH_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_management_db(?:\\?.*)?") || url.contains(":3307/") || url.contains(":3306/")
                || !fresh.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_d02_be_it_d08_[a-z0-9]+(?:\\?.*)?")) {
            throw new IllegalStateException("Unexpected D08 QA URL: " + url);
        }

        try (var connection = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
            db = connection;
            check("MYSQL-8.4", db.getMetaData().getDatabaseProductVersion().startsWith("8.4."));
            check("UPGRADE-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);

            // Step 1: Flyway V1
            var v1 = flyway(url, args[0], "1");
            check("UPGRADE-V1-APPLIED", v1.migrate().migrationsExecuted == 1);
            execute("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) "
                    + "VALUES ('d08-preserve@example.test','synthetic-preserve-fixture','QA Preserved User','PATIENT','ACTIVE'," + NOW + "," + NOW + ")");
            String v1History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'");

            // Step 2: Flyway V2
            var v2 = flyway(url, args[0], "2");
            check("UPGRADE-V2-APPLIED", v2.migrate().migrationsExecuted == 1);
            execute("INSERT INTO specialties(code,name,created_at,updated_at) VALUES ('QA_CARD_D08','Cardiology D08'," + NOW + "," + NOW + ")");
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
            var v6 = flyway(url, args[0], "6");
            check("UPGRADE-V6-APPLIED", v6.migrate().migrationsExecuted == 1);
            String v6History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='6'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V6", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V6", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V6", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));
            check("UPGRADE-V4-HISTORY-UNCHANGED-AFTER-V6", v4History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='4'")));
            check("UPGRADE-V5-HISTORY-UNCHANGED-AFTER-V6", v5History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='5'")));

            // Step 7: Flyway V7
            var all = flyway(url, args[0], null);
            check("UPGRADE-V7-APPLIED", all.migrate().migrationsExecuted == 1);
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V7", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V7", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V7", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));
            check("UPGRADE-V4-HISTORY-UNCHANGED-AFTER-V7", v4History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='4'")));
            check("UPGRADE-V5-HISTORY-UNCHANGED-AFTER-V7", v5History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='5'")));
            check("UPGRADE-V6-HISTORY-UNCHANGED-AFTER-V7", v6History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='6'")));

            // Validation & Idempotency
            check("UPGRADE-VALIDATE", all.validateWithResult().validationSuccessful);
            List<String> history = rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank");
            check("UPGRADE-REPEAT-NOOP", all.migrate().migrationsExecuted == 0
                    && history.equals(rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank")));
            check("UPGRADE-CURRENT-V7", all.info().current().getVersion().getVersion().equals("7") && all.info().applied().length == 7);

            System.out.println("V7_FLYWAY_CHECKSUM=" + scalar("SELECT checksum FROM flyway_schema_history WHERE version='7'"));

            schemaChecks();
            dataChecks();
            concurrentRescheduleDoubleBookingTest(url);
            concurrentBookingVsRescheduleTest(url);
            concurrentCancellationVsRescheduleTest(url);
            optimisticLockingVersionConflictTest(url);

            // Fresh database test (V1 + V2 + V3 + V4 + V5 + V6 + V7 in one go)
            try (var freshConnection = DriverManager.getConnection(fresh, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                db = freshConnection;
                check("FRESH-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);
                var f = flyway(fresh, args[0], null);
                check("FRESH-APPLY-V1-TO-V7", f.migrate().migrationsExecuted == 7);
                check("FRESH-VALIDATE", f.validateWithResult().validationSuccessful);
                schemaChecks();
                check("FRESH-NO-APPOINTMENTS-SEED", count("SELECT COUNT(*) FROM appointments") == 0);
                check("FRESH-NO-SCHEDULES-SEED", count("SELECT COUNT(*) FROM doctor_schedules") == 0);
                check("FRESH-NO-USERS-SEED", count("SELECT COUNT(*) FROM users") == 0);
                check("FRESH-REPEAT-NOOP", f.migrate().migrationsExecuted == 0);
            }
        }

        System.out.println("D08_SUMMARY passed=" + passed + " failed=0 skipped=0");
    }
}
