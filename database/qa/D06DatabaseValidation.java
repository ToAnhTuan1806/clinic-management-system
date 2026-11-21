import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.flywaydb.core.Flyway;

/**
 * CL-D06-DB MySQL validation: doctor_schedules table via Flyway V5.
 * Tests V1 -> V2 -> V3 -> V4 -> V5 upgrade, idempotency, schema, constraints,
 * boundary/adjacent shifts, concurrent overlap locking protocol, and V1-V4 compatibility.
 * Requires isolated MySQL 8.4 QA instance; no clean/repair/baseline/drop.
 */
class D06DatabaseValidation {
    static Connection db;
    static int passed;
    static final String NOW = "'2026-11-21 07:08:09.123456'";

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
            s.setString(1, "d06-doctor-user-" + index + "@example.test");
            s.setString(2, "QA Doctor User " + index);
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

    static void schemaChecks() throws SQLException {
        // Table count: users, specialties, doctors, patients, doctor_schedules, flyway_schema_history
        check("SCHEMA-TABLES-TOTAL", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 6);
        check("SCHEMA-SCHEDULES-TABLE-EXISTS", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND engine='InnoDB' AND table_collation='utf8mb4_0900_ai_ci'") == 1);

        // Columns check (exactly 10 columns)
        check("SCHEMA-SCHEDULES-COLUMN-COUNT", columns("doctor_schedules").size() == 10);

        // Column types and nullability
        check("SCHEMA-COL-ID", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name='id' AND column_type='bigint' AND extra='auto_increment' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-DOCTOR-ID", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name='doctor_id' AND column_type='bigint' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-WORK-DATE", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name='work_date' AND column_type='date' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-START-UTC", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name='start_at_utc' AND column_type='datetime(6)' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-END-UTC", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name='end_at_utc' AND column_type='datetime(6)' AND is_nullable='NO'") == 1);
        check("SCHEMA-COL-SLOT-MINUTES", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name='slot_minutes' AND column_type='smallint' AND is_nullable='NO' AND column_default='30'") == 1);
        check("SCHEMA-COL-STATUS", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name='status' AND column_type='varchar(16)' AND is_nullable='NO' AND column_default='ACTIVE'") == 1);
        check("SCHEMA-COL-VERSION", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name='version' AND column_type='bigint' AND is_nullable='NO' AND column_default='0'") == 1);
        check("SCHEMA-COL-TIMESTAMPS", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND column_name IN ('created_at','updated_at') AND column_type='datetime(6)' AND is_nullable='NO'") == 2);

        // PK & FK
        check("SCHEMA-SCHEDULES-PK", count("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND constraint_name='PRIMARY' AND column_name='id'") == 1);
        check("SCHEMA-SCHEDULES-FK-RESTRICT", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND referenced_table_name='doctors' AND delete_rule='RESTRICT' AND update_rule='RESTRICT'") == 1);

        // Check constraints (4 checks enforced)
        check("SCHEMA-SCHEDULES-CHECKS-ENFORCED", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND constraint_type='CHECK' AND enforced='YES'") == 4);
        check("SCHEMA-CHECK-TIME-RANGE", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND constraint_name='chk_doctor_schedules_time_range'") == 1);
        check("SCHEMA-CHECK-SLOT-MINUTES", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND constraint_name='chk_doctor_schedules_slot_minutes'") == 1);
        check("SCHEMA-CHECK-STATUS", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND constraint_name='chk_doctor_schedules_status'") == 1);
        check("SCHEMA-CHECK-VERSION", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND constraint_name='chk_doctor_schedules_version'") == 1);

        // Indexes (ix_doctor_schedules_doctor_date_status, ix_doctor_schedules_doctor_start)
        check("SCHEMA-INDEX-DOCTOR-DATE-STATUS", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND index_name='ix_doctor_schedules_doctor_date_status'") == 1);
        check("SCHEMA-INDEX-DOCTOR-START", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='doctor_schedules' AND index_name='ix_doctor_schedules_doctor_start'") == 1);
    }

    static void dataChecks() throws SQLException {
        db.setAutoCommit(false);

        long u1 = insertUser(401, "DOCTOR");
        long u2 = insertUser(402, "DOCTOR");
        long s1 = specialty("D06_SPEC_1", "QA Specialty Internal Medicine");
        long d1 = doctor(u1, s1, "D06_DR_1", "LIC_D06_1");
        long d2 = doctor(u2, s1, "D06_DR_2", "LIC_D06_2");

        // 1. Insert valid schedules
        long sch1 = schedule(d1, "2026-11-22", "2026-11-22 01:00:00.000000", "2026-11-22 05:00:00.000000", 30, "ACTIVE");
        check("DATA-INSERT-VALID-SCHEDULE", sch1 > 0);

        // 2. Adjacent shift (ca liền kề được phép): starts exactly when sch1 ends
        long schAdjacent = schedule(d1, "2026-11-22", "2026-11-22 05:00:00.000000", "2026-11-22 09:00:00.000000", 30, "ACTIVE");
        check("DATA-ADJACENT-SHIFT-ALLOWED", schAdjacent > sch1);

        // 3. Different doctor at the exact same time
        long schDoc2 = schedule(d2, "2026-11-22", "2026-11-22 01:00:00.000000", "2026-11-22 05:00:00.000000", 60, "ACTIVE");
        check("DATA-DIFFERENT-DOCTOR-SAME-TIME-ALLOWED", schDoc2 > 0);

        // 4. BLOCKED status shift
        long schBlocked = schedule(d1, "2026-11-22", "2026-11-22 10:00:00.000000", "2026-11-22 12:00:00.000000", 15, "BLOCKED");
        check("DATA-BLOCKED-STATUS-ALLOWED", schBlocked > 0);

        // 5. slot_minutes valid values (15, 30, 60)
        check("DATA-SLOT-MINUTES-OPTIONS", count("SELECT COUNT(*) FROM doctor_schedules WHERE slot_minutes IN (15,30,60)") == 4);

        // 6. start >= end rejected
        rejects("CHECK-START-EQUALS-END", 3819, () -> schedule(d1, "2026-11-23", "2026-11-23 02:00:00.000000", "2026-11-23 02:00:00.000000", 30, "ACTIVE"));
        rejects("CHECK-START-GREATER-THAN-END", 3819, () -> schedule(d1, "2026-11-23", "2026-11-23 03:00:00.000000", "2026-11-23 02:00:00.000000", 30, "ACTIVE"));

        // 7. slot_minutes invalid rejected
        rejects("CHECK-SLOT-MINUTES-INVALID-45", 3819, () -> schedule(d1, "2026-11-23", "2026-11-23 01:00:00.000000", "2026-11-23 04:00:00.000000", 45, "ACTIVE"));
        rejects("CHECK-SLOT-MINUTES-INVALID-0", 3819, () -> schedule(d1, "2026-11-23", "2026-11-23 01:00:00.000000", "2026-11-23 04:00:00.000000", 0, "ACTIVE"));

        // 8. status invalid rejected
        rejects("CHECK-STATUS-INVALID-CLOSED", 3819, () -> schedule(d1, "2026-11-23", "2026-11-23 01:00:00.000000", "2026-11-23 04:00:00.000000", 30, "CLOSED"));
        rejects("CHECK-STATUS-LOWERCASE", 3819, () -> schedule(d1, "2026-11-23", "2026-11-23 01:00:00.000000", "2026-11-23 04:00:00.000000", 30, "active"));

        // 9. version < 0 rejected
        rejects("CHECK-VERSION-NEGATIVE", 3819, () -> execute("UPDATE doctor_schedules SET version=-1 WHERE id=" + sch1));

        // 10. FK orphan doctor rejected
        rejects("FK-ORPHAN-DOCTOR", 1452, () -> schedule(9223372036854775806L, "2026-11-23", "2026-11-23 01:00:00.000000", "2026-11-23 04:00:00.000000", 30, "ACTIVE"));

        // 11. Delete/Update referenced doctor rejected (RESTRICT)
        rejects("FK-DELETE-REFERENCED-DOCTOR", 1451, () -> execute("DELETE FROM doctors WHERE id=" + d1));
        rejects("FK-UPDATE-REFERENCED-DOCTOR-ID", 1451, () -> execute("UPDATE doctors SET id=9223372036854775806 WHERE id=" + d1));

        // 12. Not null enforcement
        for (String col : List.of("doctor_id", "work_date", "start_at_utc", "end_at_utc", "slot_minutes", "status", "version", "created_at", "updated_at")) {
            rejects("NOT-NULL-" + col, 1048, () -> execute("UPDATE doctor_schedules SET " + col + "=NULL WHERE id=" + sch1));
        }

        // 13. EXPLAIN query verification using indexes
        check("EXPLAIN-SCHEDULES-PK", rows("EXPLAIN SELECT * FROM doctor_schedules WHERE id=" + sch1).get(0).contains("PRIMARY"));
        check("EXPLAIN-SCHEDULES-DATE-STATUS", rows("EXPLAIN SELECT * FROM doctor_schedules WHERE doctor_id=" + d1 + " AND work_date='2026-11-22' AND status='ACTIVE'").get(0).contains("ix_doctor_schedules_doctor_date_status"));
        check("EXPLAIN-SCHEDULES-START-RANGE", rows("EXPLAIN SELECT * FROM doctor_schedules WHERE doctor_id=" + d1 + " AND start_at_utc >= '2026-11-22 00:00:00'").get(0).contains("ix_doctor_schedules_doctor_start"));

        // Rollback verification
        db.rollback();
        db.setAutoCommit(true);
        check("DATA-ROLLBACK-CLEAN", count("SELECT COUNT(*) FROM doctor_schedules") == 0);
    }

    /**
     * Simulates the project's transactional locking protocol on MySQL:
     * Writers lock `doctors` row via `SELECT id FROM doctors WHERE id = ? FOR UPDATE`,
     * then evaluate active schedule overlaps [start_at_utc < newEnd AND end_at_utc > newStart].
     * Proves that two concurrent overlapping schedule requests for the same doctor cannot both succeed.
     */
    static void concurrentOverlapTest(String url) throws Exception {
        db.setAutoCommit(true);
        long u = insertUser(499, "DOCTOR");
        long s = specialty("D06_LOCK_SPEC", "QA Lock Spec");
        long doctorId = doctor(u, s, "D06_LOCK_DR", "LIC_LOCK_1");

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(2);
        AtomicBoolean thread1Success = new AtomicBoolean(false);
        AtomicBoolean thread2Success = new AtomicBoolean(false);
        AtomicBoolean thread2ConflictDetected = new AtomicBoolean(false);

        // Task 1: Book shift 08:00 to 11:00 VN (01:00 to 04:00 UTC)
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                // 1. Lock doctor
                try (var stmt = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    stmt.setLong(1, doctorId);
                    stmt.executeQuery().next();
                }
                // Sleep briefly to hold the lock while thread 2 attempts to proceed
                Thread.sleep(300);
                // 2. Check overlap
                String checkSql = "SELECT COUNT(*) FROM doctor_schedules WHERE doctor_id = ? AND status = 'ACTIVE' "
                        + "AND start_at_utc < '2026-11-25 04:00:00.000000' AND end_at_utc > '2026-11-25 01:00:00.000000'";
                try (var stmt = conn.prepareStatement(checkSql)) {
                    stmt.setLong(1, doctorId);
                    var rs = stmt.executeQuery();
                    rs.next();
                    if (rs.getLong(1) == 0) {
                        // Insert shift 1
                        String insertSql = "INSERT INTO doctor_schedules(doctor_id, work_date, start_at_utc, end_at_utc, slot_minutes, status, version, created_at, updated_at) "
                                + "VALUES (?, '2026-11-25', '2026-11-25 01:00:00.000000', '2026-11-25 04:00:00.000000', 30, 'ACTIVE', 0, " + NOW + ", " + NOW + ")";
                        try (var ins = conn.prepareStatement(insertSql)) {
                            ins.setLong(1, doctorId);
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

        // Task 2: Attempt overlapping shift 09:00 to 12:00 VN (02:00 to 05:00 UTC)
        pool.submit(() -> {
            try (Connection conn = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                conn.setAutoCommit(false);
                startLatch.await();
                // Sleep slightly so Thread 1 takes lock first
                Thread.sleep(50);
                // 1. Lock doctor (will block until Thread 1 commits)
                try (var stmt = conn.prepareStatement("SELECT id FROM doctors WHERE id = ? FOR UPDATE")) {
                    stmt.setLong(1, doctorId);
                    stmt.executeQuery().next();
                }
                // 2. Check overlap (now sees Thread 1's committed shift)
                String checkSql = "SELECT COUNT(*) FROM doctor_schedules WHERE doctor_id = ? AND status = 'ACTIVE' "
                        + "AND start_at_utc < '2026-11-25 05:00:00.000000' AND end_at_utc > '2026-11-25 02:00:00.000000'";
                try (var stmt = conn.prepareStatement(checkSql)) {
                    stmt.setLong(1, doctorId);
                    var rs = stmt.executeQuery();
                    rs.next();
                    if (rs.getLong(1) == 0) {
                        String insertSql = "INSERT INTO doctor_schedules(doctor_id, work_date, start_at_utc, end_at_utc, slot_minutes, status, version, created_at, updated_at) "
                                + "VALUES (?, '2026-11-25', '2026-11-25 02:00:00.000000', '2026-11-25 05:00:00.000000', 30, 'ACTIVE', 0, " + NOW + ", " + NOW + ")";
                        try (var ins = conn.prepareStatement(insertSql)) {
                            ins.setLong(1, doctorId);
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

        check("CONCURRENT-LOCKING-COMPLETED", completed);
        check("CONCURRENT-THREAD-1-COMMITTED", thread1Success.get());
        check("CONCURRENT-THREAD-2-CONFLICT-DETECTED", thread2ConflictDetected.get());
        check("CONCURRENT-THREAD-2-BLOCKED-FROM-INSERT", !thread2Success.get());
        check("CONCURRENT-EXACTLY-ONE-SCHEDULE-PERSISTED", count("SELECT COUNT(*) FROM doctor_schedules WHERE doctor_id=" + doctorId) == 1);
    }

    public static void main(String[] args) throws Exception {
        if (!env("CLINIC_QA_ACK").equals("NEW_D06_INSTANCE_ONLY")) {
            throw new IllegalStateException("New isolated QA instance required");
        }
        String url = env("DB_URL"), fresh = env("DB_FRESH_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_management_db(?:\\?.*)?") || url.contains(":3307/") || url.contains(":3306/")
                || !fresh.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_d02_be_it_d06_[a-z0-9]+(?:\\?.*)?")) {
            throw new IllegalStateException("Unexpected D06 QA URL: " + url);
        }

        try (var connection = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
            db = connection;
            check("MYSQL-8.4", db.getMetaData().getDatabaseProductVersion().startsWith("8.4."));
            check("UPGRADE-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);

            // Step 1: Flyway V1
            var v1 = flyway(url, args[0], "1");
            check("UPGRADE-V1-APPLIED", v1.migrate().migrationsExecuted == 1);
            execute("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) "
                    + "VALUES ('d06-preserve@example.test','synthetic-preserve-fixture','QA Preserved User','PATIENT','ACTIVE'," + NOW + "," + NOW + ")");
            String v1History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'");

            // Step 2: Flyway V2
            var v2 = flyway(url, args[0], "2");
            check("UPGRADE-V2-APPLIED", v2.migrate().migrationsExecuted == 1);
            execute("INSERT INTO specialties(code,name,created_at,updated_at) VALUES ('QA_CARD_D06','Cardiology D06'," + NOW + "," + NOW + ")");
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
            var all = flyway(url, args[0], null);
            check("UPGRADE-V5-APPLIED", all.migrate().migrationsExecuted == 1);
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V5", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V5", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V5", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));
            check("UPGRADE-V4-HISTORY-UNCHANGED-AFTER-V5", v4History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='4'")));

            // Validation & Idempotency
            check("UPGRADE-VALIDATE", all.validateWithResult().validationSuccessful);
            List<String> history = rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank");
            check("UPGRADE-REPEAT-NOOP", all.migrate().migrationsExecuted == 0
                    && history.equals(rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank")));
            check("UPGRADE-CURRENT-V5", all.info().current().getVersion().getVersion().equals("5") && all.info().applied().length == 5);

            System.out.println("V5_FLYWAY_CHECKSUM=" + scalar("SELECT checksum FROM flyway_schema_history WHERE version='5'"));

            schemaChecks();
            dataChecks();
            concurrentOverlapTest(url);

            // Fresh database test (V1 + V2 + V3 + V4 + V5 in one go)
            try (var freshConnection = DriverManager.getConnection(fresh, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                db = freshConnection;
                check("FRESH-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);
                var f = flyway(fresh, args[0], null);
                check("FRESH-APPLY-V1-TO-V5", f.migrate().migrationsExecuted == 5);
                check("FRESH-VALIDATE", f.validateWithResult().validationSuccessful);
                schemaChecks();
                check("FRESH-NO-SCHEDULES-SEED", count("SELECT COUNT(*) FROM doctor_schedules") == 0);
                check("FRESH-NO-USERS-SEED", count("SELECT COUNT(*) FROM users") == 0);
                check("FRESH-REPEAT-NOOP", f.migrate().migrationsExecuted == 0);
            }
        }

        System.out.println("D06_SUMMARY passed=" + passed + " failed=0 skipped=0");
    }
}
