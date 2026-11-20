import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;

/**
 * D04 MySQL validation: Patient schema V3, profile fields alignment, constraints, and privacy QA.
 * Requires isolated MySQL 8.4 QA instance; no clean/repair/baseline/drop.
 */
class D04DatabaseValidation {
    static Connection db;
    static int passed;
    static final String NOW = "'2026-11-21 03:04:05.123456'";

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
            s.setString(1, "d04-user-" + index + "@example.test");
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

    static long patient(Long userId, String code, String name, String dob, String sex, String phone, String address) throws SQLException {
        String sql = "INSERT INTO patients(user_id,patient_code,full_name,date_of_birth,sex,phone,address,is_active,created_at,updated_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, 1, " + NOW + ", " + NOW + ")";
        try (var s = db.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            if (userId != null) s.setLong(1, userId); else s.setNull(1, Types.BIGINT);
            s.setString(2, code);
            s.setString(3, name);
            if (dob != null) s.setDate(4, java.sql.Date.valueOf(dob)); else s.setNull(4, Types.DATE);
            s.setString(5, sex);
            s.setString(6, phone);
            s.setString(7, address);
            s.executeUpdate();
            try (var keys = s.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    static void schema() throws SQLException {
        check("SCHEMA-TABLES-TOTAL", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 5);
        check("SCHEMA-INNODB-UTF8MB4", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND engine='InnoDB' AND table_collation='utf8mb4_0900_ai_ci'") == 1);
        check("SCHEMA-COLUMN-COUNT-PATIENTS", columns("patients").size() == 11);

        check("SCHEMA-PATIENTS-PK-BIGINT-SIGNED", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND column_name='id' AND column_type='bigint' AND is_nullable='NO'") == 1);
        check("SCHEMA-PATIENTS-AUTO-INCREMENT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND column_name='id' AND extra='auto_increment'") == 1);
        check("SCHEMA-PATIENTS-PK-CONSTRAINT", count("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND constraint_name='PRIMARY' AND column_name='id'") == 1);

        check("SCHEMA-PATIENTS-USER-ID-NULLABLE-BIGINT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND column_name='user_id' AND column_type='bigint' AND is_nullable='YES'") == 1);
        check("SCHEMA-PATIENTS-UNIQUE-KEYS", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND constraint_type='UNIQUE'") == 2);
        check("SCHEMA-PATIENTS-UNIQUE-USER", count("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND constraint_name='uk_patients_user' AND column_name='user_id'") == 1);
        check("SCHEMA-PATIENTS-UNIQUE-CODE", count("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND constraint_name='uk_patients_code' AND column_name='patient_code'") == 1);

        check("SCHEMA-PATIENTS-FK-RESTRICT", count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() "
                + "AND table_name='patients' AND referenced_table_name='users' AND delete_rule='RESTRICT' AND update_rule='RESTRICT'") == 1);
        check("SCHEMA-PATIENTS-FK-COLUMN", count("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND column_name='user_id' AND referenced_table_name='users' AND referenced_column_name='id'") == 1);

        check("SCHEMA-PATIENTS-CHECKS-ENFORCED", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND constraint_type='CHECK' AND enforced='YES'") == 6);

        check("SCHEMA-PATIENTS-TIMESTAMP-PRECISION", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND column_name IN ('created_at','updated_at') AND column_type='datetime(6)' AND is_nullable='NO'") == 2);

        check("SCHEMA-PATIENTS-FIELD-LENGTHS", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='patients' "
                + "AND ((column_name='patient_code' AND character_maximum_length=32) "
                + "OR (column_name='full_name' AND character_maximum_length=120) "
                + "OR (column_name='sex' AND character_maximum_length=16) "
                + "OR (column_name='phone' AND character_maximum_length=24) "
                + "OR (column_name='address' AND character_maximum_length=255))") == 5);

        check("SCHEMA-PATIENTS-ACTIVE-DEFAULT", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND column_name='is_active' AND is_nullable='NO' AND column_default='1'") == 1);

        check("SCHEMA-PATIENTS-OPTIONAL-NULLABLE", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND column_name IN ('user_id','date_of_birth','sex','phone','address') AND is_nullable='YES'") == 5);

        check("SCHEMA-PATIENTS-INDEXES", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND index_name IN ('ix_patients_active_name_id','ix_patients_phone')") == 2);
    }

    static void dataChecks() throws SQLException {
        db.setAutoCommit(false);

        long u1 = insertUser(1, "PATIENT");
        long u2 = insertUser(2, "PATIENT");
        long u3 = insertUser(3, "PATIENT");

        long p1 = patient(u1, "PT_001", "QA Patient One", "1990-05-15", "FEMALE", "0901234567", "123 Synthetic St");
        long p2 = patient(u2, "PT_002", "QA Patient Two", "1985-10-20", "MALE", "0901234567", "456 Synthetic Rd");
        check("DATA-MULTIPLE-SAME-PHONE", count("SELECT COUNT(*) FROM patients WHERE phone='0901234567'") == 2);
        check("DATA-DIFFERENT-PATIENTS-SAME-PHONE", p1 > 0 && p2 > 0 && p1 != p2);

        long p3 = patient(null, "PT_003", "QA Walkin Patient Three", null, "OTHER", "0909999999", null);
        long p4 = patient(null, "PT_004", "QA Walkin Patient Four", "2000-01-01", "UNKNOWN", null, null);
        long p5 = patient(null, "PT_005", "QA Walkin Patient Five", null, null, null, null);
        check("DATA-MULTIPLE-NULL-USER-ID", count("SELECT COUNT(*) FROM patients WHERE user_id IS NULL") == 3);

        check("DATA-PATIENT-SEX-OPTIONS", count("SELECT COUNT(*) FROM patients WHERE sex IN ('FEMALE','MALE','OTHER','UNKNOWN')") == 4);
        check("DATA-PATIENT-NULL-SEX", count("SELECT COUNT(*) FROM patients WHERE id=" + p5 + " AND sex IS NULL") == 1);

        check("DATA-PATIENT-DEFAULT-ACTIVE", count("SELECT COUNT(*) FROM patients WHERE is_active=1") == 5);
        execute("UPDATE patients SET is_active=0 WHERE id=" + p2);
        check("DATA-PATIENT-SOFT-DEACTIVATE", count("SELECT COUNT(*) FROM patients WHERE is_active=0") == 1);

        execute("UPDATE patients SET address='123 \u0110\u01b0\u1eddng ABC, H\u00e0 N\u1ed9i \uD83C\uDFE5' WHERE id=" + p1);
        check("DATA-PATIENTS-UTF8MB4-UNICODE", scalar("SELECT address FROM patients WHERE id=" + p1)
                .equals("123 \u0110\u01b0\u1eddng ABC, H\u00e0 N\u1ed9i \uD83C\uDFE5"));

        long pSameName = patient(u3, "PT_SAME_NAME", "QA Patient One", "1995-12-12", "FEMALE", "0988888888", "Other Address");
        check("DATA-SAME-FULLNAME-ALLOWED", count("SELECT COUNT(*) FROM patients WHERE full_name='QA Patient One'") == 2);

        patient(null, "PT_SAME_DOB", "QA Another Patient", "1990-05-15", "MALE", "0977777777", null);
        check("DATA-SAME-DOB-ALLOWED", count("SELECT COUNT(*) FROM patients WHERE date_of_birth='1990-05-15'") == 2);

        rejects("UNIQUE-PATIENT-USER-DUPLICATE", 1062, () -> patient(u1, "PT_DUP_USER", "QA Dup User", null, null, null, null));
        rejects("UNIQUE-PATIENT-CODE-DUPLICATE", 1062, () -> patient(null, "PT_001", "QA Dup Code", null, null, null, null));

        rejects("FK-PATIENT-ORPHAN-USER", 1452, () -> patient(9223372036854775806L, "PT_ORPHAN", "QA Orphan User", null, null, null, null));
        rejects("FK-PATIENT-UPDATE-ORPHAN-USER", 1452, () -> execute("UPDATE patients SET user_id=9223372036854775806 WHERE id=" + p1));
        rejects("FK-PATIENT-DELETE-REFERENCED-USER", 1451, () -> execute("DELETE FROM users WHERE id=" + u1));
        rejects("FK-PATIENT-UPDATE-REFERENCED-USER", 1451, () -> execute("UPDATE users SET id=9223372036854775806 WHERE id=" + u1));

        rejects("CHECK-PATIENT-CODE-LOWERCASE", 3819, () -> patient(null, "pt_lower", "QA Lower Code", null, null, null, null));
        rejects("CHECK-PATIENT-CODE-PADDED", 3819, () -> patient(null, " PT_PAD ", "QA Padded Code", null, null, null, null));
        rejects("CHECK-PATIENT-CODE-EMPTY", 3819, () -> patient(null, "", "QA Empty Code", null, null, null, null));

        rejects("CHECK-PATIENT-NAME-BLANK", 3819, () -> patient(null, "PT_BLANK_NAME", "   ", null, null, null, null));
        rejects("CHECK-PATIENT-NAME-PADDED", 3819, () -> patient(null, "PT_PAD_NAME", " QA Padded Name ", null, null, null, null));

        rejects("CHECK-PATIENT-SEX-INVALID", 3819, () -> patient(null, "PT_BAD_SEX", "QA Bad Sex", null, "INVALID", null, null));
        rejects("CHECK-PATIENT-SEX-LOWERCASE", 3819, () -> patient(null, "PT_LOWER_SEX", "QA Lower Sex", null, "female", null, null));

        rejects("CHECK-PATIENT-PHONE-EMPTY", 3819, () -> patient(null, "PT_BLANK_PHONE", "QA Blank Phone", null, null, "   ", null));

        rejects("CHECK-PATIENT-ACTIVE-INVALID", 3819, () -> execute("UPDATE patients SET is_active=2 WHERE id=" + p1));

        for (String col : List.of("patient_code", "full_name", "is_active", "created_at", "updated_at")) {
            rejects("NOT-NULL-PATIENTS-" + col, 1048, () -> execute("UPDATE patients SET " + col + "=NULL WHERE id=" + p1));
        }

        rejects("LENGTH-PATIENT-CODE-EXCEEDED", 1406, () -> patient(null, "A".repeat(33), "QA Long Code", null, null, null, null));
        rejects("LENGTH-PATIENT-NAME-EXCEEDED", 1406, () -> patient(null, "PT_LONG_NAME", "A".repeat(121), null, null, null, null));
        rejects("LENGTH-PATIENT-PHONE-EXCEEDED", 1406, () -> patient(null, "PT_LONG_PHONE", "QA Long Phone", null, null, "1".repeat(25), null));
        rejects("LENGTH-PATIENT-ADDRESS-EXCEEDED", 1406, () -> patient(null, "PT_LONG_ADDR", "QA Long Addr", null, null, null, "A".repeat(256)));

        // Index explain verification
        check("EXPLAIN-PK-LOOKUP", rows("EXPLAIN SELECT * FROM patients WHERE id=" + p1).get(0).contains("PRIMARY"));
        check("EXPLAIN-CODE-LOOKUP", rows("EXPLAIN SELECT * FROM patients WHERE patient_code='PT_001'").get(0).contains("uk_patients_code"));
        check("EXPLAIN-USER-LOOKUP", rows("EXPLAIN SELECT * FROM patients WHERE user_id=" + u1).get(0).contains("uk_patients_user"));
        check("EXPLAIN-PHONE-LOOKUP", rows("EXPLAIN SELECT * FROM patients WHERE phone='0901234567'").get(0).contains("ix_patients_phone"));
        check("EXPLAIN-ACTIVE-NAME-LOOKUP", rows("EXPLAIN SELECT * FROM patients WHERE is_active=1 AND full_name LIKE 'QA%'").get(0).contains("ix_patients_active_name_id"));

        db.rollback();
        db.setAutoCommit(true);
        check("DATA-PATIENT-FIXTURES-ROLLED-BACK", count("SELECT COUNT(*) FROM patients") == 0);
    }

    public static void main(String[] args) throws Exception {
        if (!env("CLINIC_QA_ACK").equals("NEW_D04_INSTANCE_ONLY")) {
            throw new IllegalStateException("New isolated QA instance required");
        }
        String url = env("DB_URL"), fresh = env("DB_FRESH_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_management_db(?:\\?.*)?") || url.contains(":3307/") || url.contains(":3306/")
                || !fresh.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_d02_be_it_d04_[a-z0-9]+(?:\\?.*)?")) {
            throw new IllegalStateException("Unexpected D04 QA URL: " + url);
        }

        try (var connection = DriverManager.getConnection(url, env("DB_USERNAME"), env("DB_PASSWORD"))) {
            db = connection;
            check("MYSQL-8.4", db.getMetaData().getDatabaseProductVersion().startsWith("8.4."));
            check("UPGRADE-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);

            // Step 1: Flyway V1
            var v1 = flyway(url, args[0], "1");
            check("UPGRADE-V1-APPLIED", v1.migrate().migrationsExecuted == 1);
            execute("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) "
                    + "VALUES ('d04-preserve@example.test','synthetic-preserve-fixture','QA Preserved User','PATIENT','ACTIVE'," + NOW + "," + NOW + ")");
            List<String> userColumnsV1 = columns("users");
            List<String> userRowsV1 = rows("SELECT * FROM users ORDER BY id");
            String v1History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'");

            // Step 2: Flyway V2
            var v2 = flyway(url, args[0], "2");
            check("UPGRADE-V2-APPLIED", v2.migrate().migrationsExecuted == 1);
            execute("INSERT INTO specialties(code,name,created_at,updated_at) VALUES ('QA_CARD','Cardiology'," + NOW + "," + NOW + ")");
            String v2History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V2", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-USERS-UNCHANGED-AFTER-V2", userColumnsV1.equals(columns("users")) && userRowsV1.equals(rows("SELECT * FROM users ORDER BY id")));

            // Step 3: Flyway V3
            var all = flyway(url, args[0], null);
            check("UPGRADE-V3-APPLIED", all.migrate().migrationsExecuted == 1);
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V3", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V3", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-USERS-UNCHANGED-AFTER-V3", userColumnsV1.equals(columns("users")) && userRowsV1.equals(rows("SELECT * FROM users ORDER BY id")));

            // Validation & Idempotency
            check("UPGRADE-VALIDATE", all.validateWithResult().validationSuccessful);
            List<String> history = rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank");
            check("UPGRADE-REPEAT-NOOP", all.migrate().migrationsExecuted == 0
                    && history.equals(rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank")));
            check("UPGRADE-CURRENT-V3", all.info().current().getVersion().getVersion().equals("3") && all.info().applied().length == 3);

            System.out.println("V3_FLYWAY_CHECKSUM=" + scalar("SELECT checksum FROM flyway_schema_history WHERE version='3'"));

            schema();
            dataChecks();

            // Fresh database test (V1 + V2 + V3 in one go)
            try (var freshConnection = DriverManager.getConnection(fresh, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                db = freshConnection;
                check("FRESH-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);
                var f = flyway(fresh, args[0], null);
                check("FRESH-APPLY-V1-V2-V3", f.migrate().migrationsExecuted == 3);
                check("FRESH-VALIDATE", f.validateWithResult().validationSuccessful);
                schema();
                check("FRESH-NO-PATIENTS-SEED", count("SELECT COUNT(*) FROM patients") == 0);
                check("FRESH-NO-USERS-SEED", count("SELECT COUNT(*) FROM users") == 0);
                check("FRESH-REPEAT-NOOP", f.migrate().migrationsExecuted == 0);
            }
        }

        System.out.println("D04_SUMMARY passed=" + passed + " failed=0");
    }
}
