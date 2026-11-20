import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;

/** D03-only MySQL checks. Fresh QA schemas required; no clean/repair/baseline/drop. */
class D03DatabaseValidation {
    static Connection db;
    static int passed;
    static final String NOW = "'2026-11-21 02:03:04.123456'";
    static void check(String id, boolean result) {
        if (!result) throw new AssertionError(id);
        passed++;
        System.out.println("PASS " + id);
    }
    static String env(String key) {
        String v=System.getenv(key);
        if(v==null||v.isBlank()) throw new IllegalStateException("Missing QA variable: "+key);
        return v;
    }
    static Flyway flyway(String url,String location,String target) {
        var config=Flyway.configure().dataSource(url,env("DB_USERNAME"),env("DB_PASSWORD"))
                .locations("filesystem:"+Path.of(location).toAbsolutePath().toString().replace('\\','/'))
                .baselineOnMigrate(false).cleanDisabled(true).validateMigrationNaming(true);
        if(target!=null) config.target(target);
        return config.load();
    }
    static String scalar(String query) throws SQLException {
        try(var s=db.createStatement(); var r=s.executeQuery(query)) { r.next(); return r.getString(1); }
    }
    static long count(String query) throws SQLException { return Long.parseLong(scalar(query)); }
    static void execute(String sql) throws SQLException { try(var s=db.createStatement()){s.executeUpdate(sql);} }
    static List<String> rows(String query) throws SQLException {
        List<String> values=new ArrayList<>();
        try(var s=db.createStatement();var r=s.executeQuery(query)) {
            while(r.next()) {
                var row=new ArrayList<String>();
                for(int i=1;i<=r.getMetaData().getColumnCount();i++) row.add(r.getString(i));
                values.add(String.join("|",row));
            }
        }
        return values;
    }
    static List<String> columns(String table) throws SQLException {
        return rows("SELECT column_name,column_type,is_nullable,COALESCE(column_default,'<NULL>'),extra,COALESCE(collation_name,'<NULL>') FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='"+table+"' ORDER BY ordinal_position");
    }
    interface SqlAction { void run() throws SQLException; }
    static void rejects(String id,int code,SqlAction action) throws SQLException {
        Savepoint save=db.setSavepoint();
        try { action.run(); throw new AssertionError(id+" accepted invalid data"); }
        catch(SQLException error){check(id,error.getErrorCode()==code);}
        finally {db.rollback(save);db.releaseSavepoint(save);}
    }
    static long insertUser(int index) throws SQLException {
        try(var s=db.prepareStatement("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) VALUES (?,'synthetic-non-authenticating-fixture','QA Doctor','DOCTOR','ACTIVE',"+NOW+","+NOW+")",Statement.RETURN_GENERATED_KEYS)) {
            s.setString(1,"d03-doctor-"+index+"@example.test"); s.executeUpdate();
            try(var keys=s.getGeneratedKeys()){keys.next();return keys.getLong(1);}
        }
    }
    static long specialty(String code,String name) throws SQLException {
        try(var s=db.prepareStatement("INSERT INTO specialties(code,name,created_at,updated_at) VALUES (?, ?,"+NOW+","+NOW+")",Statement.RETURN_GENERATED_KEYS)) {
            s.setString(1,code); s.setString(2,name); s.executeUpdate();
            try(var keys=s.getGeneratedKeys()){keys.next();return keys.getLong(1);}
        }
    }
    static long doctor(long user,long specialty,String code,String license) throws SQLException {
        try(var s=db.prepareStatement("INSERT INTO doctors(user_id,specialty_id,doctor_code,license_number,created_at,updated_at) VALUES (?,?,?, ?,"+NOW+","+NOW+")",Statement.RETURN_GENERATED_KEYS)) {
            s.setLong(1,user);s.setLong(2,specialty);s.setString(3,code);s.setString(4,license);s.executeUpdate();
            try(var keys=s.getGeneratedKeys()){keys.next();return keys.getLong(1);}
        }
    }
    static void schema() throws SQLException {
        check("SCHEMA-TABLES",count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()") == 4);
        check("SCHEMA-INNODB-UTF8MB4",count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('specialties','doctors') AND engine='InnoDB' AND table_collation='utf8mb4_0900_ai_ci'")==2);
        check("SCHEMA-COLUMN-COUNTS",columns("specialties").size()==7 && columns("doctors").size()==9);
        check("SCHEMA-BIGINT-SIGNED",count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='specialties' AND column_name='id') OR (table_name='doctors' AND column_name IN ('id','user_id','specialty_id'))) AND column_type='bigint' AND is_nullable='NO'")==4);
        check("SCHEMA-AUTO-INCREMENT",count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('specialties','doctors') AND column_name='id' AND extra='auto_increment'")==2);
        check("SCHEMA-PK",count("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name IN ('specialties','doctors') AND constraint_name='PRIMARY' AND column_name='id'")==2);
        check("SCHEMA-UNIQUE-KEYS",count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() AND table_name IN ('specialties','doctors') AND constraint_type='UNIQUE'")==5);
        check("SCHEMA-FK-RESTRICT",count("SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='doctors' AND referenced_table_name IN ('users','specialties') AND delete_rule='RESTRICT' AND update_rule='RESTRICT'")==2);
        check("SCHEMA-FK-COLUMNS",count("SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='doctors' AND ((column_name='user_id' AND referenced_table_name='users' AND referenced_column_name='id') OR (column_name='specialty_id' AND referenced_table_name='specialties' AND referenced_column_name='id'))")==2);
        check("SCHEMA-CHECKS-ENFORCED",count("SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() AND table_name IN ('specialties','doctors') AND constraint_type='CHECK' AND enforced='YES'")==8);
        check("SCHEMA-TIMESTAMP-PRECISION",count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('specialties','doctors') AND column_name IN ('created_at','updated_at') AND column_type='datetime(6)' AND is_nullable='NO' AND column_default IS NULL")==4);
        check("SCHEMA-LENGTHS",count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='specialties' AND ((column_name='code' AND character_maximum_length=32) OR (column_name='name' AND character_maximum_length=120))) OR (table_name='doctors' AND ((column_name='doctor_code' AND character_maximum_length=32) OR (column_name='license_number' AND character_maximum_length=100))))")==4);
        check("SCHEMA-ACTIVE-DEFAULTS",count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('specialties','doctors') AND column_name='is_active' AND is_nullable='NO' AND column_default='1'")==2);
        check("SCHEMA-OPTIONAL-FIELDS",count("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='specialties' AND column_name='description') OR (table_name='doctors' AND column_name IN ('license_number','biography'))) AND is_nullable='YES'")==3);
        check("SCHEMA-QUERY-INDEXES",count("SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() AND index_name IN ('ix_specialties_active_code_id','ix_doctors_specialty_active_id')")==2);
        check("SCHEMA-NO-CATALOG-SEED",count("SELECT COUNT(*) FROM specialties")==0 && count("SELECT COUNT(*) FROM doctors")==0);
    }
    static void dataChecks() throws SQLException {
        db.setAutoCommit(false);
        long s1=specialty("QA_ENT","QA Ear Clinic"),s2=specialty("QA_CARD","QA Cardiology");
        long u1=insertUser(1),u2=insertUser(2),u3=insertUser(3),u4=insertUser(4);
        long d1=doctor(u1,s1,"QA_DR_1",null),d2=doctor(u2,s1,"QA_DR_2",null);
        doctor(u3,s2,"QA_DR_3","QA-LICENSE-3");
        check("DATA-DEFAULT-ACTIVE",count("SELECT COUNT(*) FROM specialties WHERE is_active=1")==2 && count("SELECT COUNT(*) FROM doctors WHERE is_active=1")==3);
        check("DATA-MULTIPLE-NULL-LICENSES",count("SELECT COUNT(*) FROM doctors WHERE license_number IS NULL")==2);
        check("DATA-MANY-DOCTORS-ONE-SPECIALTY",count("SELECT COUNT(*) FROM doctors WHERE specialty_id="+s1)==2);
        check("DATA-GENERATED-IDS",s1>0 && d1>0 && d2>d1);
        check("DATA-MICROSECONDS",scalar("SELECT DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') FROM doctors WHERE id="+d1).equals("2026-11-21 02:03:04.123456"));
        execute("UPDATE specialties SET description='QA Unicode \u0110\u1ed7 \uD83D\uDE00' WHERE id="+s1);
        check("DATA-UTF8MB4",scalar("SELECT description FROM specialties WHERE id="+s1).equals("QA Unicode \u0110\u1ed7 \uD83D\uDE00"));
        execute("UPDATE doctors SET is_active=0 WHERE id="+d2);
        check("DATA-SOFT-DEACTIVATE",count("SELECT COUNT(*) FROM doctors")==3 && count("SELECT COUNT(*) FROM doctors WHERE is_active=0")==1);
        rejects("UNIQUE-SPECIALTY-CODE",1062,()->specialty("QA_ENT","QA Other Name"));
        rejects("UNIQUE-SPECIALTY-NAME-CASE",1062,()->specialty("QA_OTHER","qa ear clinic"));
        specialty("QA_CAFE","QA Cafe");
        rejects("UNIQUE-SPECIALTY-NAME-ACCENT",1062,()->specialty("QA_CAFE_2","QA Caf\u00e9"));
        rejects("UNIQUE-DOCTOR-USER",1062,()->doctor(u1,s2,"QA_DR_4",null));
        rejects("UNIQUE-DOCTOR-CODE",1062,()->doctor(u4,s2,"QA_DR_1",null));
        rejects("UNIQUE-DOCTOR-LICENSE",1062,()->doctor(u4,s2,"QA_DR_4","QA-LICENSE-3"));
        rejects("FK-ORPHAN-USER",1452,()->doctor(9223372036854775806L,s2,"QA_ORPHAN",null));
        rejects("FK-ORPHAN-SPECIALTY",1452,()->doctor(u4,9223372036854775806L,"QA_ORPHAN",null));
        rejects("FK-UPDATE-ORPHAN-USER",1452,()->execute("UPDATE doctors SET user_id=9223372036854775806 WHERE id="+d1));
        rejects("FK-DELETE-REFERENCED-USER",1451,()->execute("DELETE FROM users WHERE id="+u1));
        rejects("FK-DELETE-REFERENCED-SPECIALTY",1451,()->execute("DELETE FROM specialties WHERE id="+s1));
        rejects("FK-UPDATE-REFERENCED-USER",1451,()->execute("UPDATE users SET id=9223372036854775806 WHERE id="+u1));
        rejects("FK-UPDATE-REFERENCED-SPECIALTY",1451,()->execute("UPDATE specialties SET id=9223372036854775806 WHERE id="+s1));
        rejects("CHECK-SPECIALTY-LOWERCASE-CODE",3819,()->specialty("qa_lower","QA Lower"));
        rejects("CHECK-SPECIALTY-PADDED-CODE",3819,()->specialty(" QA_PAD ","QA Padded"));
        rejects("CHECK-SPECIALTY-BLANK-NAME",3819,()->specialty("QA_BLANK"," "));
        rejects("CHECK-DOCTOR-LOWERCASE-CODE",3819,()->doctor(u4,s2,"qa_lower",null));
        rejects("CHECK-DOCTOR-BLANK-LICENSE",3819,()->doctor(u4,s2,"QA_BLANK",""));
        rejects("CHECK-DOCTOR-LOWERCASE-LICENSE",3819,()->doctor(u4,s2,"QA_LOWER","qa-lower"));
        for(String table:List.of("specialties","doctors")) {
            long id=table.equals("specialties")?s1:d1;
            rejects("CHECK-"+table+"-ACTIVE-2",3819,()->execute("UPDATE "+table+" SET is_active=2 WHERE id="+id));
            List<String> required=table.equals("specialties")?List.of("code","name","is_active","created_at","updated_at"):List.of("user_id","specialty_id","doctor_code","is_active","created_at","updated_at");
            for(String column:required)
                rejects("NOT-NULL-"+table+"-"+column,1048,()->execute("UPDATE "+table+" SET "+column+"=NULL WHERE id="+id));
        }
        rejects("CHECK-DESCRIPTION-LIMIT",3819,()->execute("UPDATE specialties SET description=REPEAT('a',5001) WHERE id="+s1));
        rejects("CHECK-BIOGRAPHY-LIMIT",3819,()->execute("UPDATE doctors SET biography=REPEAT('a',5001) WHERE id="+d1));
        rejects("LENGTH-SPECIALTY-NAME",1406,()->specialty("QA_LONG","a".repeat(121)));
        rejects("LENGTH-LICENSE",1406,()->doctor(u4,s1,"QA_LONG","A".repeat(101)));
        rejects("TIMESTAMPS-REQUIRED",1364,()->execute("INSERT INTO specialties(code,name) VALUES ('QA_TIME','QA No Timestamp')"));
        db.rollback();db.setAutoCommit(true);
        check("DATA-CATALOG-FIXTURES-ROLLED-BACK",count("SELECT COUNT(*) FROM specialties")==0 && count("SELECT COUNT(*) FROM doctors")==0 && count("SELECT COUNT(*) FROM users")==1);
    }
    public static void main(String[] args) throws Exception {
        if(!env("CLINIC_QA_ACK").equals("NEW_D03_INSTANCE_ONLY")) throw new IllegalStateException("New isolated QA instance required");
        String url=env("DB_URL"),fresh=env("DB_FRESH_URL");
        if(!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_management_db(?:\\?.*)?") || url.contains(":3307/") || url.contains(":3306/")
                || !fresh.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_d02_be_it_d03_[a-z0-9]+(?:\\?.*)?")) throw new IllegalStateException("Unexpected D03 QA URL");
        try(var connection=DriverManager.getConnection(url,env("DB_USERNAME"),env("DB_PASSWORD"))) {
            db=connection;
            check("MYSQL-8.4",db.getMetaData().getDatabaseProductVersion().startsWith("8.4."));
            check("UPGRADE-EMPTY-START",count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()")==0);
            var v1=flyway(url,args[0],"1");check("UPGRADE-V1-APPLIED",v1.migrate().migrationsExecuted==1);
            execute("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) VALUES ('d03-preserve@example.test','synthetic-preserve-fixture','QA Preserved User','PATIENT','ACTIVE',"+NOW+","+NOW+")");
            List<String> userColumns=columns("users"), userRows=rows("SELECT * FROM users ORDER BY id");
            String oldHistory=scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'");
            var all=flyway(url,args[0],null);check("UPGRADE-V2-APPLIED-ONCE",all.migrate().migrationsExecuted==1);
            check("UPGRADE-V1-HISTORY-UNCHANGED",oldHistory.equals(scalar("SELECT CONCAT(installed_rank,':',script,':',checksum,':',installed_on,':',success) FROM flyway_schema_history WHERE version='1'")));
            check("UPGRADE-USERS-SCHEMA-DATA-UNCHANGED",userColumns.equals(columns("users")) && userRows.equals(rows("SELECT * FROM users ORDER BY id")));
            check("UPGRADE-VALIDATE",all.validateWithResult().validationSuccessful);
            List<String> history=rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank");
            check("UPGRADE-SECOND-NOOP",all.migrate().migrationsExecuted==0 && history.equals(rows("SELECT version,script,checksum,success,installed_on FROM flyway_schema_history ORDER BY installed_rank")));
            check("UPGRADE-CURRENT-V2",all.info().current().getVersion().getVersion().equals("2") && all.info().applied().length==2);
            System.out.println("V2_FLYWAY_CHECKSUM="+scalar("SELECT checksum FROM flyway_schema_history WHERE version='2'"));
            schema();dataChecks();
            try(var freshConnection=DriverManager.getConnection(fresh,env("DB_USERNAME"),env("DB_PASSWORD"))) {
                db=freshConnection;
                check("FRESH-EMPTY-START",count("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()")==0);
                var f=flyway(fresh,args[0],null);check("FRESH-APPLY-V1-V2",f.migrate().migrationsExecuted==2);
                check("FRESH-VALIDATE",f.validateWithResult().validationSuccessful);
                schema();
                check("FRESH-NO-USERS-SEED",count("SELECT COUNT(*) FROM users")==0);
                check("FRESH-SECOND-NOOP",f.migrate().migrationsExecuted==0);
            }
        }
        System.out.println("D03_SUMMARY passed="+passed+" failed=0");
    }
}
