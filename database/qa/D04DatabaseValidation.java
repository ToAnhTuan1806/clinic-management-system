import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;

/**
 * D04-V4 MySQL validation: User profile contact fields (phone, address) via Flyway V4.
 * Tests V1 -> V2 -> V3 -> V4 upgrade, idempotency, constraints, data preservation, and handoff.
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

    static void schemaChecks() throws SQLException {
        // Table count: users, specialties, doctors, patients, flyway_schema_history
        check("SCHEMA-TABLES-TOTAL", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 5);

        // Users schema verification (V4 additions)
        check("SCHEMA-USERS-COLUMN-COUNT", columns("users").size() == 11);
        check("SCHEMA-USERS-PHONE-EXISTS", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='users' AND column_name='phone' AND column_type='varchar(24)' AND is_nullable='YES' AND column_default IS NULL") == 1);
        check("SCHEMA-USERS-ADDRESS-EXISTS", count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() "
                + "AND table_name='users' AND column_name='address' AND column_type='varchar(255)' AND is_nullable='YES' AND column_default IS NULL") == 1);
        check("SCHEMA-USERS-CHECKS-COUNT", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='users' AND constraint_type='CHECK' AND enforced='YES'") == 5);
        check("SCHEMA-USERS-PHONE-CHECK", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='users' AND constraint_name='chk_users_phone' AND constraint_type='CHECK'") == 1);
        check("SCHEMA-USERS-ADDRESS-CHECK", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='users' AND constraint_name='chk_users_address' AND constraint_type='CHECK'") == 1);

        // Verification that doctors and patients are untouched
        check("SCHEMA-DOCTORS-COLUMN-COUNT", columns("doctors").size() == 9);
        check("SCHEMA-PATIENTS-COLUMN-COUNT", columns("patients").size() == 11);
        check("SCHEMA-PATIENTS-CHECKS-COUNT", count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND constraint_type='CHECK' AND enforced='YES'") == 6);
        check("SCHEMA-PATIENTS-INDEXES-COUNT", count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() "
                + "AND table_name='patients' AND index_name IN ('ix_patients_active_name_id','ix_patients_phone')") == 2);
    }

    static void dataChecks() throws SQLException {
        db.setAutoCommit(false);

        // Item 6 & 7: Check preserved user has phone=NULL and address=NULL
        check("DATA-PRESERVED-USER-EXISTS", count("SELECT COUNT(*) FROM users WHERE email='d04-preserve@example.test'") == 1);
        check("DATA-PRESERVED-USER-FIELDS-NULL", count("SELECT COUNT(*) FROM users WHERE email='d04-preserve@example.test' "
                + "AND phone IS NULL AND address IS NULL") == 1);

        // Item 8: Cập nhật phone hợp lệ
        execute("UPDATE users SET phone='0901234567' WHERE email='d04-preserve@example.test'");
        check("DATA-UPDATE-PHONE-VALID", scalar("SELECT phone FROM users WHERE email='d04-preserve@example.test'").equals("0901234567"));

        // Item 9: Cập nhật address Unicode tiếng Việt
        String vnAddress = "123 \u0110\u01b0\u1eddng Tr\u1ea7n H\u01b0ng \u0110\u1ea1o, Ph\u01b0\u1eddng 1, Qu\u1eadn 5, TP. H\u1ed3 Ch\u00ed Minh \uD83C\uDFE5";
        try (var s = db.prepareStatement("UPDATE users SET address=? WHERE email='d04-preserve@example.test'")) {
            s.setString(1, vnAddress);
            s.executeUpdate();
        }
        check("DATA-UPDATE-ADDRESS-UNICODE-VN", scalar("SELECT address FROM users WHERE email='d04-preserve@example.test'").equals(vnAddress));

        // Item 10: Xóa phone/address về NULL
        execute("UPDATE users SET phone=NULL, address=NULL WHERE email='d04-preserve@example.test'");
        check("DATA-CLEAR-CONTACT-TO-NULL", count("SELECT COUNT(*) FROM users WHERE email='d04-preserve@example.test' "
                + "AND phone IS NULL AND address IS NULL") == 1);

        // Item 11: Phone dài quá 24 bị từ chối
        rejects("CONSTRAINT-PHONE-TOO-LONG", 1406, () -> execute("UPDATE users SET phone='" + "1".repeat(25) + "' WHERE email='d04-preserve@example.test'"));

        // Item 12: Address dài quá 255 bị từ chối
        rejects("CONSTRAINT-ADDRESS-TOO-LONG", 1406, () -> execute("UPDATE users SET address='" + "A".repeat(256) + "' WHERE email='d04-preserve@example.test'"));

        // Item 13: Phone chỉ có khoảng trắng bị từ chối
        rejects("CONSTRAINT-PHONE-SPACES-ONLY", 3819, () -> execute("UPDATE users SET phone='    ' WHERE email='d04-preserve@example.test'"));
        rejects("CONSTRAINT-PHONE-EMPTY-STRING", 3819, () -> execute("UPDATE users SET phone='' WHERE email='d04-preserve@example.test'"));
        rejects("CONSTRAINT-PHONE-UNTRIMMED", 3819, () -> execute("UPDATE users SET phone=' 0901234567 ' WHERE email='d04-preserve@example.test'"));

        // Item 14: Hai users có cùng phone vẫn hợp lệ (phone không UNIQUE)
        long u1 = insertUser(101, "PATIENT");
        long u2 = insertUser(102, "PATIENT");
        execute("UPDATE users SET phone='0988776655' WHERE id=" + u1);
        execute("UPDATE users SET phone='0988776655' WHERE id=" + u2);
        check("DATA-SAME-PHONE-TWO-USERS-ALLOWED", count("SELECT COUNT(*) FROM users WHERE phone='0988776655'") == 2);

        // Hai users có cùng address vẫn hợp lệ (address không UNIQUE)
        execute("UPDATE users SET address='Chung c\u01b0 A, H\u00e0 N\u1ed9i' WHERE id=" + u1);
        execute("UPDATE users SET address='Chung c\u01b0 A, H\u00e0 N\u1ed9i' WHERE id=" + u2);
        check("DATA-SAME-ADDRESS-TWO-USERS-ALLOWED", count("SELECT COUNT(*) FROM users WHERE address='Chung c\u01b0 A, H\u00e0 N\u1ed9i'") == 2);

        // Item 17: Không ảnh hưởng bảng patients
        long p1 = patient(u1, "PT_V4_001", "QA Patient V4 One", "1992-03-04", "FEMALE", "0988776655", "Hanoi");
        long p2 = patient(u2, "PT_V4_002", "QA Patient V4 Two", "1995-07-08", "MALE", "0988776655", "Hanoi");
        check("DATA-PATIENTS-UNAFFECTED", p1 > 0 && p2 > 0 && count("SELECT COUNT(*) FROM patients WHERE phone='0988776655'") == 2);

        // Patient constraints remain enforced
        rejects("PATIENTS-UNIQUE-CODE-STILL-ENFORCED", 1062, () -> patient(null, "PT_V4_001", "Dup Code", null, null, null, null));
        rejects("PATIENTS-CHECK-SEX-STILL-ENFORCED", 3819, () -> patient(null, "PT_V4_BADSEX", "Bad Sex", null, "INVALID", null, null));

        // Item 15: Rollback khi gặp constraint violation
        db.rollback();
        db.setAutoCommit(true);
        check("DATA-ROLLBACK-CLEAN", count("SELECT COUNT(*) FROM users WHERE email='d04-user-101@example.test'") == 0);
        check("DATA-PRESERVED-USER-STILL-INTACT", count("SELECT COUNT(*) FROM users WHERE email='d04-preserve@example.test'") == 1);
    }

    public static void main(String[] args) throws Exception {
        if (!env("CLINIC_QA_ACK").equals("NEW_D04_INSTANCE_ONLY")) {
            throw new IllegalStateException("New isolated QA instance required");
        }
        String url = env("DB_URL"), fresh = env("DB_FRESH_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_management_db(?:\\?.*)?") || url.contains(":3307/") || url.contains(":3306/")
                || !fresh.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_d02_be_it_d04(?:v4)?_[a-z0-9]+(?:\\?.*)?")) {
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
            String v1History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'");

            // Step 2: Flyway V2
            var v2 = flyway(url, args[0], "2");
            check("UPGRADE-V2-APPLIED", v2.migrate().migrationsExecuted == 1);
            execute("INSERT INTO specialties(code,name,created_at,updated_at) VALUES ('QA_CARD','Cardiology'," + NOW + "," + NOW + ")");
            String v2History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V2", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));

            // Step 3: Flyway V3
            var v3 = flyway(url, args[0], "3");
            check("UPGRADE-V3-APPLIED", v3.migrate().migrationsExecuted == 1);
            String v3History = scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'");
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V3", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V3", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));

            // Step 4: Flyway V4
            var all = flyway(url, args[0], null);
            check("UPGRADE-V4-APPLIED", all.migrate().migrationsExecuted == 1);
            check("UPGRADE-V1-HISTORY-UNCHANGED-AFTER-V4", v1History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-V2-HISTORY-UNCHANGED-AFTER-V4", v2History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='2'")));
            check("UPGRADE-V3-HISTORY-UNCHANGED-AFTER-V4", v3History.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='3'")));

            // Validation & Idempotency
            check("UPGRADE-VALIDATE", all.validateWithResult().validationSuccessful);
            List<String> history = rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank");
            check("UPGRADE-REPEAT-NOOP", all.migrate().migrationsExecuted == 0
                    && history.equals(rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank")));
            check("UPGRADE-CURRENT-V4", all.info().current().getVersion().getVersion().equals("4") && all.info().applied().length == 4);

            System.out.println("V4_FLYWAY_CHECKSUM=" + scalar("SELECT checksum FROM flyway_schema_history WHERE version='4'"));

            schemaChecks();
            dataChecks();

            // Fresh database test (V1 + V2 + V3 + V4 in one go)
            try (var freshConnection = DriverManager.getConnection(fresh, env("DB_USERNAME"), env("DB_PASSWORD"))) {
                db = freshConnection;
                check("FRESH-EMPTY-START", count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 0);
                var f = flyway(fresh, args[0], null);
                check("FRESH-APPLY-V1-V2-V3-V4", f.migrate().migrationsExecuted == 4);
                check("FRESH-VALIDATE", f.validateWithResult().validationSuccessful);
                schemaChecks();
                check("FRESH-NO-USERS-SEED", count("SELECT COUNT(*) FROM users") == 0);
                check("FRESH-NO-PATIENTS-SEED", count("SELECT COUNT(*) FROM patients") == 0);
                check("FRESH-REPEAT-NOOP", f.migrate().migrationsExecuted == 0);
            }
        }

        System.out.println("D04_V4_SUMMARY passed=" + passed + " failed=0");
    }
}
