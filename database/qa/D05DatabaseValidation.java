import java.sql.DriverManager;

/** Reuses existing D04 upgrade checks and D03 SQL probes on the final V4 schema. */
class D05DatabaseValidation extends D04DatabaseValidation {
    public static void main(String[] args) throws Exception {
        D04DatabaseValidation.main(args);
        // Preserve synthetic rows from every domain table across the V3 -> V4 upgrade.
        String preserveUrl = env("DB_PRESERVE_URL");
        if (!preserveUrl.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_d02_be_it_d05_preserve_[a-z0-9]+(?:\\?.*)?")
                || preserveUrl.contains(":3306/") || preserveUrl.contains(":3307/")) {
            throw new IllegalStateException("Unexpected D05 preservation URL");
        }
        var v3 = flyway(preserveUrl, args[0], "3");
        check("PRESERVE-APPLY-V1-V2-V3", v3.migrate().migrationsExecuted == 3);
        try (var connection = DriverManager.getConnection(preserveUrl, env("DB_USERNAME"), env("DB_PASSWORD"))) {
            db = connection;
            D03DatabaseValidation.db = connection;
            long user = insertUser(300, "DOCTOR");
            long specialty = D03DatabaseValidation.specialty("D05_OLD", "QA Preserved Specialty");
            D03DatabaseValidation.doctor(user, specialty, "D05_OLD_DOCTOR", null);
            patient(null, "D05_OLD_PATIENT", "QA Preserved Patient", "1990-01-01", "UNKNOWN", null, null);
            var users = rows("SELECT id,email,password_hash,full_name,role,status,last_login_at,created_at,updated_at FROM users ORDER BY id");
            var doctors = rows("SELECT * FROM doctors ORDER BY id");
            var specialties = rows("SELECT * FROM specialties ORDER BY id");
            var patients = rows("SELECT * FROM patients ORDER BY id");
            var v4 = flyway(preserveUrl, args[0], null);
            check("PRESERVE-APPLY-ONLY-V4", v4.migrate().migrationsExecuted == 1);
            check("PRESERVE-USER-ALL-OLD-FIELDS", users.equals(rows("SELECT id,email,password_hash,full_name,role,status,last_login_at,created_at,updated_at FROM users ORDER BY id")));
            check("PRESERVE-DOCTOR-ROWS", doctors.equals(rows("SELECT * FROM doctors ORDER BY id")));
            check("PRESERVE-SPECIALTY-ROWS", specialties.equals(rows("SELECT * FROM specialties ORDER BY id")));
            check("PRESERVE-PATIENT-ROWS", patients.equals(rows("SELECT * FROM patients ORDER BY id")));
            check("PRESERVE-VALIDATE-NOOP", v4.validateWithResult().validationSuccessful && v4.migrate().migrationsExecuted == 0);
        }
        // The runner owns this new instance; D04 has just migrated this fresh schema.
        try (var connection = DriverManager.getConnection(env("DB_FRESH_URL"), env("DB_USERNAME"), env("DB_PASSWORD"))) {
            db = connection;
            D03DatabaseValidation.db = connection;
            check("FINAL-ALL-TABLES-INNODB-UTF8MB4", count("SELECT COUNT(*) FROM information_schema.tables "
                    + "WHERE table_schema=DATABASE() AND table_name IN ('users','doctors','specialties','patients') "
                    + "AND engine='InnoDB' AND table_collation='utf8mb4_0900_ai_ci'") == 4);
            check("FINAL-ALL-FK-RESTRICT", count("SELECT COUNT(*) FROM information_schema.referential_constraints "
                    + "WHERE constraint_schema=DATABASE() AND delete_rule='RESTRICT' AND update_rule='RESTRICT'") == 3);
            check("FINAL-PATIENT-PHONE-NOT-UNIQUE", count("SELECT COUNT(*) FROM information_schema.statistics "
                    + "WHERE table_schema=DATABASE() AND table_name='patients' AND column_name='phone' AND non_unique=0") == 0);
            insertUser(200, "PATIENT");
            // Existing negative SQL tests check duplicate keys, FK enforcement, CHECKs,
            // Unicode, soft deactivation and rollback on the actual final schema.
            D03DatabaseValidation.dataChecks();
            db.setAutoCommit(false);
            long user = insertUser(201, "PATIENT");
            long patient = patient(user, "D05_PATIENT", "QA Unicode \u0110\u1ed7 \uD83C\uDFE5", null, "UNKNOWN", "0900000000", "H\u00e0 N\u1ed9i");
            patient(null, "D05_WALKIN", "QA Walkin", null, null, "0900000000", null);
            check("FINAL-PATIENT-SHARED-PHONE", count("SELECT COUNT(*) FROM patients WHERE phone='0900000000'") == 2);
            check("FINAL-PATIENT-UNICODE", scalar("SELECT full_name FROM patients WHERE id=" + patient).equals("QA Unicode \u0110\u1ed7 \uD83C\uDFE5"));
            rejects("FINAL-PATIENT-UNIQUE-USER", 1062, () -> patient(user, "D05_DUP_USER", "QA Duplicate", null, null, null, null));
            rejects("FINAL-PATIENT-FK-ORPHAN", 1452, () -> patient(9223372036854775806L, "D05_ORPHAN", "QA Orphan", null, null, null, null));
            rejects("FINAL-PATIENT-FK-DELETE", 1451, () -> execute("DELETE FROM users WHERE id=" + user));
            rejects("FINAL-PATIENT-CHECK-NAME", 3819, () -> execute("UPDATE patients SET full_name=' ' WHERE id=" + patient));
            rejects("FINAL-PATIENT-CHECK-PHONE", 3819, () -> execute("UPDATE patients SET phone=' ' WHERE id=" + patient));
            rejects("FINAL-PATIENT-CHECK-ACTIVE", 3819, () -> execute("UPDATE patients SET is_active=2 WHERE id=" + patient));
            rejects("FINAL-USER-UNIQUE-EMAIL", 1062, () -> insertUser(201, "PATIENT"));
            rejects("FINAL-USER-CHECK-ROLE", 3819, () -> execute("UPDATE users SET role='SUPERUSER' WHERE id=" + user));
            rejects("FINAL-USER-CHECK-STATUS", 3819, () -> execute("UPDATE users SET status='UNKNOWN' WHERE id=" + user));
            rejects("FINAL-USER-CHECK-EMAIL", 3819, () -> execute("UPDATE users SET email='UPPER@example.test' WHERE id=" + user));
            execute("UPDATE patients SET is_active=0 WHERE id=" + patient);
            check("FINAL-PATIENT-SOFT-DELETE-RETAINS-ROW", count("SELECT COUNT(*) FROM patients WHERE id=" + patient + " AND is_active=0") == 1);
            db.rollback();
            check("FINAL-PATIENT-FIXTURES-ROLLED-BACK", count("SELECT COUNT(*) FROM patients") == 0);
            db.setAutoCommit(true);
        }
        System.out.println("D05_SUMMARY passed=" + (passed + D03DatabaseValidation.passed) + " failed=0 skipped=0");
    }
}
