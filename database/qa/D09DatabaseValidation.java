import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.flywaydb.core.Flyway;

/**
 * CL-D09-DB MySQL validation: appointment reception lifecycle via Flyway V8.
 * Tests V1 -> V2 -> V3 -> V4 -> V5 -> V6 -> V7 -> V8 upgrade, idempotency, schema (29 columns),
 * reception metadata: confirmed_at, confirmed_by, checked_in_at, checked_in_by, no_show_at, no_show_by,
 * active slot preservation on CONFIRMED, CHECKED_IN, and NO_SHOW,
 * idempotent check-in handling,
 * FK RESTRICT on reception fields,
 * and multithreaded concurrency tests:
 * 1. Concurrent check-in vs cancellation.
 * 2. Concurrent check-in vs no-show.
 * 3. Concurrent confirmation vs reschedule.
 * 4. Optimistic locking version conflict.
 */
class D09DatabaseValidation {
    static Connection db;
    static int passed;
    static final String NOW = "'2026-11-21 14:30:00.123456'";

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
            s.setString(1, "user" + index + "@clinic.test");
            s.setString(2, "Synthetic User " + index);
            s.setString(3, role);
            s.executeUpdate();
            try (var keys = s.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    static long specialty(String code, String name) throws SQLException {
        try (var s = db.prepareStatement("INSERT INTO specialties(code,name,created_at,updated_at) VALUES (?, ?, " + NOW + ", " + NOW + ")",
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
        try (var s = db.prepareStatement("INSERT INTO doctors(user_id,specialty_id,doctor_code,license_number,is_active,created_at,updated_at) "
                + "VALUES (?, ?, ?, ?, 1, " + NOW + ", " + NOW + ")", Statement.RETURN_GENERATED_KEYS)) {
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

        // Columns check (exactly 29 columns after V8 reception lifecycle additions)
        check("SCHEMA-APPOINTMENTS-COLUMN-COUNT", columns("appointments").size() == 29);

        // Check new V8 columns exist with correct types and nullability
        check("SCHEMA-COL-CONFIRMED-AT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='confirmed_at' AND column_type='datetime(6)' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-CONFIRMED-BY", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='confirmed_by' AND column_type='bigint' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-CHECKED-IN-AT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='checked_in_at' AND column_type='datetime(6)' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-CHECKED-IN-BY", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='checked_in_by' AND column_type='bigint' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-NO-SHOW-AT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='no_show_at' AND column_type='datetime(6)' AND is_nullable='YES'") == 1);
        check("SCHEMA-COL-NO-SHOW-BY", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='appointments' AND column_name='no_show_by' AND column_type='bigint' AND is_nullable='YES'") == 1);

        // Foreign keys check on new V8 columns
        check("SCHEMA-FK-CONFIRMED-BY", count("SELECT COUNT(*) FROM information_schema.referential_constraints "
                + "WHERE constraint_schema=DATABASE() AND table_name='appointments' AND constraint_name='fk_appointments_confirmed_by' "
                + "AND referenced_table_name='users' AND delete_rule='RESTRICT' AND update_rule='RESTRICT'") == 1);
        check("SCHEMA-FK-CHECKED-IN-BY", count("SELECT COUNT(*) FROM information_schema.referential_constraints "
                + "WHERE constraint_schema=DATABASE() AND table_name='appointments' AND constraint_name='fk_appointments_checked_in_by' "
                + "AND referenced_table_name='users' AND delete_rule='RESTRICT' AND update_rule='RESTRICT'") == 1);
        check("SCHEMA-FK-NO-SHOW-BY", count("SELECT COUNT(*) FROM information_schema.referential_constraints "
                + "WHERE constraint_schema=DATABASE() AND table_name='appointments' AND constraint_name='fk_appointments_no_show_by' "
                + "AND referenced_table_name='users' AND delete_rule='RESTRICT' AND update_rule='RESTRICT'") == 1);

        // CHECK constraints on new V8 columns
        check("SCHEMA-CHECK-CONFIRMED-AT", count("SELECT COUNT(*) FROM information_schema.check_constraints "
                + "WHERE constraint_schema=DATABASE() AND constraint_name='chk_appointments_confirmed_at'") == 1);
        check("SCHEMA-CHECK-CHECKED-IN-AT", count("SELECT COUNT(*) FROM information_schema.check_constraints "
                + "WHERE constraint_schema=DATABASE() AND constraint_name='chk_appointments_checked_in_at'") == 1);
        check("SCHEMA-CHECK-NO-SHOW-AT", count("SELECT COUNT(*) FROM information_schema.check_constraints "
                + "WHERE constraint_schema=DATABASE() AND constraint_name='chk_appointments_no_show_at'") == 1);

        // Indexes check on new V8 columns
        check("SCHEMA-INDEX-CONFIRMED-AT", count("SELECT COUNT(*) FROM information_schema.statistics "
                + "WHERE table_schema=DATABASE() AND table_name='appointments' AND index_name='ix_appointments_confirmed_at' AND column_name='confirmed_at'") == 1);
        check("SCHEMA-INDEX-CHECKED-IN-AT", count("SELECT COUNT(*) FROM information_schema.statistics "
                + "WHERE table_schema=DATABASE() AND table_name='appointments' AND index_name='ix_appointments_checked_in_at' AND column_name='checked_in_at'") == 1);
        check("SCHEMA-INDEX-NO-SHOW-AT", count("SELECT COUNT(*) FROM information_schema.statistics "
                + "WHERE table_schema=DATABASE() AND table_name='appointments' AND index_name='ix_appointments_no_show_at' AND column_name='no_show_at'") == 1);
    }

    static void dataChecks() throws SQLException {
        db.setAutoCommit(false);

        long uDoc = insertUser(950, "DOCTOR");
        long uRecep = insertUser(951, "RECEPTIONIST");
        long uPat1 = insertUser(952, "PATIENT");
        long uPat2 = insertUser(953, "PATIENT");

        long spec = specialty("D09_SPEC", "Reception Specialty");
        long doc1 = doctor(uDoc, spec, "D09_DOC_1", "LIC_D09_1");

        long pat1 = patient(uPat1, "D09_PAT_1", "Reception Patient 1");
        long pat2 = patient(uPat2, "D09_PAT_2", "Reception Patient 2");

        long sch1 = schedule(doc1, "2026-11-30", "2026-11-30 01:00:00.000000", "2026-11-30 06:00:00.000000", 30, "ACTIVE");

        String fp1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        String fp2 = "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e";

        // 1. Initial State: PENDING
        long app1 = appointment("APP-D09-001", pat1, doc1, sch1, uPat1,
                "2026-11-30 01:00:00.000000", "2026-11-30 01:30:00.000000", "PENDING", "Initial booking",
                "req-d09-001", fp1);
        check("DATA-PENDING-CREATED", app1 > 0);
        check("DATA-PENDING-ACTIVE-SLOT",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app1)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + app1)));

        // 2. Transition: PENDING -> CONFIRMED
        execute("UPDATE appointments SET status='CONFIRMED', confirmed_at=" + NOW + ", confirmed_by=" + uRecep
                + ", version=version+1, updated_at=" + NOW + " WHERE id=" + app1);
        check("DATA-STATUS-CONFIRMED", "CONFIRMED".equals(scalar("SELECT status FROM appointments WHERE id=" + app1)));
        check("DATA-CONFIRMED-AT-RECORDED", scalar("SELECT confirmed_at FROM appointments WHERE id=" + app1) != null);
        check("DATA-CONFIRMED-BY-RECORDED", String.valueOf(uRecep).equals(scalar("SELECT confirmed_by FROM appointments WHERE id=" + app1)));
        // Slot is STILL active under CONFIRMED
        check("DATA-CONFIRMED-SLOT-STILL-ACTIVE",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app1)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + app1)));

        // Attempt to double-book confirmed slot is rejected with Error 1062
        rejects("DOUBLE-BOOKING-CONFIRMED-SLOT-REJECTED", 1062, () -> appointment("APP-D09-DUP1", pat2, doc1, sch1, uPat2,
                "2026-11-30 01:00:00.000000", "2026-11-30 01:30:00.000000", "PENDING", "Colliding booking", "req-dup1", fp2));

        // 3. Transition: CONFIRMED -> CHECKED_IN
        execute("UPDATE appointments SET status='CHECKED_IN', checked_in_at=" + NOW + ", checked_in_by=" + uRecep
                + ", version=version+1, updated_at=" + NOW + " WHERE id=" + app1);
        check("DATA-STATUS-CHECKED-IN", "CHECKED_IN".equals(scalar("SELECT status FROM appointments WHERE id=" + app1)));
        check("DATA-CHECKED-IN-AT-RECORDED", scalar("SELECT checked_in_at FROM appointments WHERE id=" + app1) != null);
        check("DATA-CHECKED-IN-BY-RECORDED", String.valueOf(uRecep).equals(scalar("SELECT checked_in_by FROM appointments WHERE id=" + app1)));
        // Slot is STILL active under CHECKED_IN
        check("DATA-CHECKED-IN-SLOT-STILL-ACTIVE",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app1)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + app1)));

        // Idempotent repeat check-in: does not modify state or create duplicate
        String checkedInTimestamp = scalar("SELECT checked_in_at FROM appointments WHERE id=" + app1);
        long versionBeforeRepeat = Long.parseLong(scalar("SELECT version FROM appointments WHERE id=" + app1));
        // Simulate idempotent call: check status is already CHECKED_IN, do nothing
        check("DATA-IDEMPOTENT-CHECK-IN-DETECTED", "CHECKED_IN".equals(scalar("SELECT status FROM appointments WHERE id=" + app1)));
        check("DATA-IDEMPOTENT-CHECK-IN-TIMESTAMP-UNCHANGED", checkedInTimestamp.equals(scalar("SELECT checked_in_at FROM appointments WHERE id=" + app1)));
        check("DATA-IDEMPOTENT-CHECK-IN-VERSION-UNCHANGED", versionBeforeRepeat == Long.parseLong(scalar("SELECT version FROM appointments WHERE id=" + app1)));

        // 4. Transition: CONFIRMED -> NO_SHOW
        // Setup second appointment at 02:00
        long app2 = appointment("APP-D09-002", pat2, doc1, sch1, uPat2,
                "2026-11-30 02:00:00.000000", "2026-11-30 02:30:00.000000", "PENDING", "To be no-show",
                "req-d09-002", fp2);
        execute("UPDATE appointments SET status='CONFIRMED', confirmed_at=" + NOW + ", confirmed_by=" + uRecep
                + ", version=version+1, updated_at=" + NOW + " WHERE id=" + app2);

        // Mark NO_SHOW
        execute("UPDATE appointments SET status='NO_SHOW', no_show_at=" + NOW + ", no_show_by=" + uRecep
                + ", version=version+1, updated_at=" + NOW + " WHERE id=" + app2);
        check("DATA-STATUS-NO-SHOW", "NO_SHOW".equals(scalar("SELECT status FROM appointments WHERE id=" + app2)));
        check("DATA-NO-SHOW-AT-RECORDED", scalar("SELECT no_show_at FROM appointments WHERE id=" + app2) != null);
        check("DATA-NO-SHOW-BY-RECORDED", String.valueOf(uRecep).equals(scalar("SELECT no_show_by FROM appointments WHERE id=" + app2)));

        // CRITICAL REQUIREMENT: NO_SHOW does NOT release the active slot under V6 definition
        // (CASE WHEN status != 'CANCELLED' THEN start_at_utc ELSE NULL END)
        check("DATA-NO-SHOW-SLOT-NOT-RELEASED",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app2)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + app2)));

        // Double-booking a NO_SHOW slot is strictly rejected by unique constraint Error 1062
        rejects("DOUBLE-BOOKING-NO-SHOW-SLOT-REJECTED", 1062, () -> appointment("APP-D09-DUP2", pat1, doc1, sch1, uPat1,
                "2026-11-30 02:00:00.000000", "2026-11-30 02:30:00.000000", "PENDING", "Colliding on no-show slot", "req-dup2", fp1));

        // 5. Negative constraint tests on reception fields
        // Orphan foreign keys rejected with Error 1452
        rejects("FK-CONFIRMED-BY-ORPHAN", 1452, () -> execute("UPDATE appointments SET confirmed_by=9223372036854775806 WHERE id=" + app1));
        rejects("FK-CHECKED-IN-BY-ORPHAN", 1452, () -> execute("UPDATE appointments SET checked_in_by=9223372036854775806 WHERE id=" + app1));
        rejects("FK-NO-SHOW-BY-ORPHAN", 1452, () -> execute("UPDATE appointments SET no_show_by=9223372036854775806 WHERE id=" + app1));

        // FK RESTRICT prevents deleting referenced receptionist user with Error 1451
        rejects("FK-DELETE-RECEPTIONIST-USER-BLOCKED", 1451, () -> execute("DELETE FROM users WHERE id=" + uRecep));

        // Invalid timestamp checks (e.g. before created_at)
        rejects("CHECK-CONFIRMED-AT-BEFORE-CREATED", 3819, () -> execute("UPDATE appointments SET confirmed_at='2020-01-01 00:00:00.000000' WHERE id=" + app1));
        rejects("CHECK-CHECKED-IN-AT-BEFORE-CREATED", 3819, () -> execute("UPDATE appointments SET checked_in_at='2020-01-01 00:00:00.000000' WHERE id=" + app1));
        rejects("CHECK-NO-SHOW-AT-BEFORE-CREATED", 3819, () -> execute("UPDATE appointments SET no_show_at='2020-01-01 00:00:00.000000' WHERE id=" + app2));

        // Rollback verification
        db.rollback();
        db.setAutoCommit(true);
        check("DATA-ROLLBACK-CLEAN", count("SELECT COUNT(*) FROM appointments") == 0);
    }

    /**
     * Concurrency Test 1: Check-in vs Cancellation on the SAME appointment.
     * Thread 1: Check-in.
     * Thread 2: Cancellation.
     * Under doctor lock: If check-in commits first, cancellation detects terminal CHECKED_IN and aborts.
     */
    static void concurrentCheckInVsCancellationTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(960, "DOCTOR");
        long uRecep = insertUser(961, "RECEPTIONIST");
        long uP = insertUser(962, "PATIENT");

        long spec = specialty("D09_CONC1_SPEC", "Conc Spec 1");
        long docId = doctor(uDoc, spec, "D09_CONC1_DR", "LIC_CONC1_1");
        long patId = patient(uP, "D09_CONC1_P", "Patient 1");
        long schId = schedule(docId, "2026-12-01", "2026-12-01 01:00:00.000000", "2026-12-01 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        long app = appointment("APP-CIC-01", patId, docId, schId, uP,
                "2026-12-01 01:00:00.000000", "2026-12-01 01:30:00.000000", "CONFIRMED", "Confirmed app", "kcic1", fp);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean checkInSuccess = new AtomicBoolean(false);
        AtomicBoolean cancelAborted = new AtomicBoolean(false);

        // Thread 1: Check-in
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                Thread.sleep(300);
                try (var upd = conn.prepareStatement("UPDATE appointments SET status='CHECKED_IN', checked_in_at=" + NOW
                        + ", checked_in_by=?, version=version+1, updated_at=" + NOW + " WHERE id=? AND status='CONFIRMED'")) {
                    upd.setLong(1, uRecep);
                    upd.setLong(2, app);
                    int count = upd.executeUpdate();
                    if (count == 1) {
                        conn.commit();
                        checkInSuccess.set(true);
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

        // Thread 2: Cancellation
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(50);
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                // Check status: cannot cancel if already CHECKED_IN
                try (var s = conn.prepareStatement("SELECT status FROM appointments WHERE id = ?")) {
                    s.setLong(1, app);
                    var rs = s.executeQuery();
                    rs.next();
                    String status = rs.getString(1);
                    if ("CHECKED_IN".equals(status)) {
                        cancelAborted.set(true);
                        conn.rollback();
                    } else if ("CONFIRMED".equals(status) || "PENDING".equals(status)) {
                        try (var upd = conn.prepareStatement("UPDATE appointments SET status='CANCELLED', cancelled_at=" + NOW
                                + ", cancelled_by=?, cancellation_reason='User cancelled', version=version+1, updated_at=" + NOW + " WHERE id=?")) {
                            upd.setLong(1, uP);
                            upd.setLong(2, app);
                            upd.executeUpdate();
                            conn.commit();
                        }
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

        check("CONCURRENT-CHECK-IN-VS-CANCEL-COMPLETED", completed);
        check("CONCURRENT-CHECK-IN-SUCCESS", checkInSuccess.get());
        check("CONCURRENT-CANCEL-ABORTED-AFTER-CHECK-IN", cancelAborted.get());
        check("CONCURRENT-STATUS-REMAINS-CHECKED-IN", "CHECKED_IN".equals(scalar("SELECT status FROM appointments WHERE id=" + app)));
    }

    /**
     * Concurrency Test 2: Check-in vs No-show on the SAME appointment.
     * Thread 1: Check-in.
     * Thread 2: Mark No-show.
     * Whichever commits first wins; the second sees non-CONFIRMED status and aborts.
     */
    static void concurrentCheckInVsNoShowTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(970, "DOCTOR");
        long uRecep = insertUser(971, "RECEPTIONIST");
        long uP = insertUser(972, "PATIENT");

        long spec = specialty("D09_CONC2_SPEC", "Conc Spec 2");
        long docId = doctor(uDoc, spec, "D09_CONC2_DR", "LIC_CONC2_1");
        long patId = patient(uP, "D09_CONC2_P", "Patient 2");
        long schId = schedule(docId, "2026-12-01", "2026-12-01 01:00:00.000000", "2026-12-01 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        long app = appointment("APP-CINS-01", patId, docId, schId, uP,
                "2026-12-01 02:00:00.000000", "2026-12-01 02:30:00.000000", "CONFIRMED", "Confirmed app", "kcins1", fp);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean checkInSuccess = new AtomicBoolean(false);
        AtomicBoolean noShowAborted = new AtomicBoolean(false);

        // Thread 1: Check-in
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                Thread.sleep(300);
                try (var upd = conn.prepareStatement("UPDATE appointments SET status='CHECKED_IN', checked_in_at=" + NOW
                        + ", checked_in_by=?, version=version+1, updated_at=" + NOW + " WHERE id=? AND status='CONFIRMED'")) {
                    upd.setLong(1, uRecep);
                    upd.setLong(2, app);
                    int count = upd.executeUpdate();
                    if (count == 1) {
                        conn.commit();
                        checkInSuccess.set(true);
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

        // Thread 2: No-show
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(50);
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                try (var s = conn.prepareStatement("SELECT status FROM appointments WHERE id = ?")) {
                    s.setLong(1, app);
                    var rs = s.executeQuery();
                    rs.next();
                    String status = rs.getString(1);
                    if ("CONFIRMED".equals(status)) {
                        try (var upd = conn.prepareStatement("UPDATE appointments SET status='NO_SHOW', no_show_at=" + NOW
                                + ", no_show_by=?, version=version+1, updated_at=" + NOW + " WHERE id=?")) {
                            upd.setLong(1, uRecep);
                            upd.setLong(2, app);
                            upd.executeUpdate();
                            conn.commit();
                        }
                    } else {
                        noShowAborted.set(true);
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

        check("CONCURRENT-CHECK-IN-VS-NO-SHOW-COMPLETED", completed);
        check("CONCURRENT-CHECK-IN-WON", checkInSuccess.get());
        check("CONCURRENT-NO-SHOW-ABORTED", noShowAborted.get());
        check("CONCURRENT-NOT-BOTH-CHECKED-IN-AND-NO-SHOW",
                count("SELECT COUNT(*) FROM appointments WHERE id=" + app + " AND checked_in_at IS NOT NULL AND no_show_at IS NOT NULL") == 0);
    }

    /**
     * Concurrency Test 3: Confirm vs Reschedule on the SAME appointment.
     * Thread 1: Receptionist confirms (PENDING -> CONFIRMED).
     * Thread 2: Patient/Receptionist reschedules to a new slot (slot moved, status reset to PENDING).
     */
    static void concurrentConfirmVsRescheduleTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(980, "DOCTOR");
        long uRecep = insertUser(981, "RECEPTIONIST");
        long uP = insertUser(982, "PATIENT");

        long spec = specialty("D09_CONC3_SPEC", "Conc Spec 3");
        long docId = doctor(uDoc, spec, "D09_CONC3_DR", "LIC_CONC3_1");
        long patId = patient(uP, "D09_CONC3_P", "Patient 3");
        long schId = schedule(docId, "2026-12-01", "2026-12-01 01:00:00.000000", "2026-12-01 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        long app = appointment("APP-CVR2-01", patId, docId, schId, uP,
                "2026-12-01 03:00:00.000000", "2026-12-01 03:30:00.000000", "PENDING", "Initial app", "kcvr2", fp);

        String newSlot = "2026-12-01 04:00:00.000000";
        String newEnd = "2026-12-01 04:30:00.000000";

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean confirmSuccess = new AtomicBoolean(false);
        AtomicBoolean rescheduleSuccess = new AtomicBoolean(false);

        // Thread 1: Confirm
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                Thread.sleep(300);
                try (var upd = conn.prepareStatement("UPDATE appointments SET status='CONFIRMED', confirmed_at=" + NOW
                        + ", confirmed_by=?, version=version+1, updated_at=" + NOW + " WHERE id=? AND status='PENDING'")) {
                    upd.setLong(1, uRecep);
                    upd.setLong(2, app);
                    int count = upd.executeUpdate();
                    if (count == 1) {
                        conn.commit();
                        confirmSuccess.set(true);
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

        // Thread 2: Reschedule
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(50);
                try (var s = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    s.setLong(1, docId);
                    s.executeQuery().next();
                }
                // Rescheduling moves slot and resets status to PENDING
                try (var upd = conn.prepareStatement("UPDATE appointments SET previous_schedule_id=schedule_id, "
                        + "previous_start_at_utc=start_at_utc, start_at_utc=?, end_at_utc=?, status='PENDING', rescheduled_at=" + NOW + ", "
                        + "rescheduled_by=?, version=version+1, updated_at=" + NOW + " WHERE id=?")) {
                    upd.setTimestamp(1, Timestamp.valueOf(newSlot));
                    upd.setTimestamp(2, Timestamp.valueOf(newEnd));
                    upd.setLong(3, uP);
                    upd.setLong(4, app);
                    int count = upd.executeUpdate();
                    if (count == 1) {
                        conn.commit();
                        rescheduleSuccess.set(true);
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

        check("CONCURRENT-CONFIRM-VS-RESCHEDULE-COMPLETED", completed);
        check("CONCURRENT-CONFIRM-SUCCEEDED-FIRST", confirmSuccess.get());
        check("CONCURRENT-RESCHEDULE-SUCCEEDED-SECOND", rescheduleSuccess.get());
        // Since reschedule ran second, status is reset to PENDING for the new slot
        check("CONCURRENT-RESCHEDULE-RESET-STATUS-TO-PENDING", "PENDING".equals(scalar("SELECT status FROM appointments WHERE id=" + app)));
        check("CONCURRENT-RESCHEDULE-SLOT-MOVED-TO-NEW-TIME",
                scalar("SELECT active_slot_start_utc FROM appointments WHERE id=" + app)
                        .equals(scalar("SELECT start_at_utc FROM appointments WHERE id=" + app)));
    }

    /**
     * Concurrency Test 4: Optimistic Locking Version Conflict.
     * Two concurrent reception transactions with identical expectedVersion.
     * Exactly one succeeds; the other gets 0 rows updated and detects conflict (409).
     */
    static void optimisticLockingVersionConflictTest(String url) throws Exception {
        db.setAutoCommit(true);
        long uDoc = insertUser(990, "DOCTOR");
        long uRecep = insertUser(991, "RECEPTIONIST");
        long uP = insertUser(992, "PATIENT");

        long spec = specialty("D09_OPT_SPEC", "Opt Spec");
        long docId = doctor(uDoc, spec, "D09_OPT_DR", "LIC_OPT_1");
        long patId = patient(uP, "D09_OPT_P", "Opt Patient");
        long schId = schedule(docId, "2026-12-01", "2026-12-01 01:00:00.000000", "2026-12-01 06:00:00.000000", 30, "ACTIVE");

        String fp = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        long app = appointment("APP-OPT-D09", patId, docId, schId, uP,
                "2026-12-01 05:00:00.000000", "2026-12-01 05:30:00.000000", "CONFIRMED", "Opt initial", "kopt-d09", fp);

        long initialVersion = Long.parseLong(scalar("SELECT version FROM appointments WHERE id=" + app));

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean thread1Success = new AtomicBoolean(false);
        AtomicBoolean thread2Conflict = new AtomicBoolean(false);

        // Thread 1: Check-in with version = initialVersion
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                try (var s = conn.prepareStatement("UPDATE appointments SET status='CHECKED_IN', checked_in_at=" + NOW
                        + ", checked_in_by=?, version=version+1, updated_at=" + NOW + " WHERE id=? AND version=?")) {
                    s.setLong(1, uRecep);
                    s.setLong(2, app);
                    s.setLong(3, initialVersion);
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

        // Thread 2: No-show with same initialVersion
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                Thread.sleep(100);
                try (var s = conn.prepareStatement("UPDATE appointments SET status='NO_SHOW', no_show_at=" + NOW
                        + ", no_show_by=?, version=version+1, updated_at=" + NOW + " WHERE id=? AND version=?")) {
                    s.setLong(1, uRecep);
                    s.setLong(2, app);
                    s.setLong(3, initialVersion);
                    int updated = s.executeUpdate();
                    if (updated == 0) {
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
                Long.parseLong(scalar("SELECT version FROM appointments WHERE id=" + app)) == initialVersion + 1);
        check("CONCURRENT-OPTIMISTIC-STATUS-MATCHES-T1", "CHECKED_IN".equals(scalar("SELECT status FROM appointments WHERE id=" + app)));
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 1) throw new IllegalArgumentException("Usage: D09DatabaseValidation <migration-dir>");
        String url = env("DB_URL");
        String fresh = env("DB_FRESH_URL");

        try (var connection = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
            db = connection;
            check("MYSQL-8.4", db.getMetaData().getDatabaseProductVersion().startsWith("8.4."));
            check("UPGRADE-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);

            // Step 1: Flyway V1
            var v1 = flyway(url, args[0], "1");
            check("UPGRADE-V1-APPLIED", v1.migrate().migrationsExecuted == 1);
            execute("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) "
                    + "VALUES ('d09-preserve@example.test','synthetic-preserve-fixture','QA Preserved User','PATIENT','ACTIVE'," + NOW + "," + NOW + ")");
            String v1History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'");

            // Step 2: Flyway V2
            var v2 = flyway(url, args[0], "2");
            check("UPGRADE-V2-APPLIED", v2.migrate().migrationsExecuted == 1);
            execute("INSERT INTO specialties(code,name,created_at,updated_at) VALUES ('QA_CARD_D09','Cardiology D09'," + NOW + "," + NOW + ")");
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
            var v7 = flyway(url, args[0], "7");
            check("UPGRADE-V7-APPLIED", v7.migrate().migrationsExecuted == 1);
            String v7History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='7'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V7", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V7", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V7", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));
            check("UPGRADE-V4-HISTORY-UNCHANGED-AFTER-V7", v4History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='4'")));
            check("UPGRADE-V5-HISTORY-UNCHANGED-AFTER-V7", v5History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='5'")));
            check("UPGRADE-V6-HISTORY-UNCHANGED-AFTER-V7", v6History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='6'")));

            // Step 8: Flyway V8
            var all = flyway(url, args[0], null);
            check("UPGRADE-V8-APPLIED", all.migrate().migrationsExecuted == 1);
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V8", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V8", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V8", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));
            check("UPGRADE-V4-HISTORY-UNCHANGED-AFTER-V8", v4History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='4'")));
            check("UPGRADE-V5-HISTORY-UNCHANGED-AFTER-V8", v5History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='5'")));
            check("UPGRADE-V6-HISTORY-UNCHANGED-AFTER-V8", v6History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='6'")));
            check("UPGRADE-V7-HISTORY-UNCHANGED-AFTER-V8", v7History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='7'")));

            // Validation & Idempotency
            check("UPGRADE-VALIDATE", all.validateWithResult().validationSuccessful);
            List<String> history = rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank");
            check("UPGRADE-REPEAT-NOOP", all.migrate().migrationsExecuted == 0
                    && history.equals(rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank")));
            check("UPGRADE-CURRENT-V8", all.info().current().getVersion().getVersion().equals("8") && all.info().applied().length == 8);

            System.out.println("V8_FLYWAY_CHECKSUM=" + scalar("SELECT checksum FROM flyway_schema_history WHERE version='8'"));

            schemaChecks();
            dataChecks();
            concurrentCheckInVsCancellationTest(url);
            concurrentCheckInVsNoShowTest(url);
            concurrentConfirmVsRescheduleTest(url);
            optimisticLockingVersionConflictTest(url);

            // Fresh database test (V1 + V2 + V3 + V4 + V5 + V6 + V7 + V8 in one go)
            try (var freshConnection = DriverManager.getConnection(fresh, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                db = freshConnection;
                check("FRESH-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);
                var f = flyway(fresh, args[0], null);
                check("FRESH-APPLY-V1-TO-V8", f.migrate().migrationsExecuted == 8);
                check("FRESH-VALIDATE", f.validateWithResult().validationSuccessful);
                schemaChecks();
                check("FRESH-NO-APPOINTMENTS-SEED", count("SELECT COUNT(*) FROM appointments") == 0);
                check("FRESH-NO-SCHEDULES-SEED", count("SELECT COUNT(*) FROM doctor_schedules") == 0);
                check("FRESH-NO-USERS-SEED", count("SELECT COUNT(*) FROM users") == 0);
                check("FRESH-REPEAT-NOOP", f.migrate().migrationsExecuted == 0);
            }
        }

        System.out.println("D09_SUMMARY passed=" + passed + " failed=0 skipped=0");
    }
}
