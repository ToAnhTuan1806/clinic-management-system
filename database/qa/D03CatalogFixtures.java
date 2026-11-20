import java.sql.*;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** Idempotent synthetic fixtures on the utility's own isolated D03 instance. Never deletes data. */
class D03CatalogFixtures {
    static final List<String> ACTORS=List.of("ADMIN","RECEPTIONIST","PATIENT","DOCTOR_LINKED","DOCTOR_ELIGIBLE","DOCTOR_INACTIVE","DOCTOR_CRUD");
    static final BCryptPasswordEncoder PASSWORDS=new BCryptPasswordEncoder(12);
    static Connection db;
    static String env(String key){String v=System.getenv(key);if(v==null||v.isBlank())throw new IllegalStateException("Missing fixture variable: "+key);return v;}
    static String scalar(String sql)throws SQLException{try(var s=db.createStatement();var r=s.executeQuery(sql)){r.next();return r.getString(1);}}
    static long count(String sql)throws SQLException{return Long.parseLong(scalar(sql));}
    static String role(String actor){return actor.startsWith("DOCTOR_")?"DOCTOR":actor;}
    static long userId(String actor)throws SQLException{try(var s=db.prepareStatement("SELECT id FROM users WHERE email=?")){s.setString(1,env("QA_"+actor+"_EMAIL"));try(var r=s.executeQuery()){if(!r.next())throw new IllegalStateException("Missing synthetic user");return r.getLong(1);}}}
    static void users()throws SQLException{
        for(String actor:ACTORS){
            String email=env("QA_"+actor+"_EMAIL"),password=env("QA_"+actor+"_PASSWORD");
            if(!email.equals(email.trim().toLowerCase(Locale.ROOT))||!email.endsWith("@example.test"))throw new IllegalStateException("Synthetic canonical email required");
            boolean exists;
            try(var s=db.prepareStatement("SELECT role,status,password_hash FROM users WHERE email=?")){
                s.setString(1,email);try(var r=s.executeQuery()){
                    exists=r.next();if(exists&&(!r.getString(1).equals(role(actor))||!r.getString(2).equals("ACTIVE")||!r.getString(3).startsWith("$2a$12$")||!PASSWORDS.matches(password,r.getString(3))))
                        throw new IllegalStateException("Existing fixture user changed; refusing to reset it");
                }
            }
            if(!exists)try(var s=db.prepareStatement("INSERT INTO users(email,password_hash,full_name,role,status,created_at,updated_at) VALUES (?,?,?,?, 'ACTIVE',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))")){
                String hash=PASSWORDS.encode(password);if(!PASSWORDS.matches(password,hash))throw new IllegalStateException("BCrypt mismatch");
                s.setString(1,email);s.setString(2,hash);s.setString(3,"QA D03 "+actor);s.setString(4,role(actor));s.executeUpdate();
            }
        }
    }
    static long specialty(String code,String name,boolean active)throws SQLException{
        try(var s=db.prepareStatement("SELECT id,name,is_active FROM specialties WHERE code=?")){
            s.setString(1,code);try(var r=s.executeQuery()){if(r.next()){
                if(!r.getString(2).equals(name)||r.getBoolean(3)!=active)throw new IllegalStateException("Existing specialty fixture changed; refusing to overwrite");return r.getLong(1);
            }}
        }
        try(var s=db.prepareStatement("INSERT INTO specialties(code,name,description,is_active,created_at,updated_at) VALUES (?,?, 'Synthetic D03 QA fixture',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",Statement.RETURN_GENERATED_KEYS)){
            s.setString(1,code);s.setString(2,name);s.setBoolean(3,active);s.executeUpdate();try(var r=s.getGeneratedKeys()){r.next();return r.getLong(1);}
        }
    }
    static long doctor(String actor,long specialty,String code,boolean active)throws SQLException{
        long user=userId(actor);
        try(var s=db.prepareStatement("SELECT id,specialty_id,doctor_code,is_active FROM doctors WHERE user_id=?")){
            s.setLong(1,user);try(var r=s.executeQuery()){if(r.next()){
                if(r.getLong(2)!=specialty||!r.getString(3).equals(code)||r.getBoolean(4)!=active)throw new IllegalStateException("Existing doctor fixture changed; refusing to overwrite");return r.getLong(1);
            }}
        }
        try(var s=db.prepareStatement("INSERT INTO doctors(user_id,specialty_id,doctor_code,license_number,biography,is_active,created_at,updated_at) VALUES (?,?,?,?,'Synthetic D03 QA profile',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",Statement.RETURN_GENERATED_KEYS)){
            s.setLong(1,user);s.setLong(2,specialty);s.setString(3,code);s.setString(4,"QA-LIC-"+actor);s.setBoolean(5,active);s.executeUpdate();try(var r=s.getGeneratedKeys()){r.next();return r.getLong(1);}
        }
    }
    static String fingerprint()throws Exception{
        var digest=MessageDigest.getInstance("SHA-256");
        for(String table:List.of("specialties","doctors"))try(var s=db.createStatement();var r=s.executeQuery("SELECT * FROM "+table+" ORDER BY id")){
            while(r.next())for(int i=1;i<=r.getMetaData().getColumnCount();i++)digest.update((String.valueOf(r.getString(i))+"\0").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        return HexFormat.of().formatHex(digest.digest());
    }
    static String catalogIds(String table,String codeColumn)throws SQLException{
        var json=new StringBuilder("{");boolean first=true;
        try(var s=db.createStatement();var r=s.executeQuery("SELECT "+codeColumn+",id FROM "+table+" ORDER BY id")){
            while(r.next()){
                String code=r.getString(1);if(!code.matches("[A-Z0-9_-]{1,32}"))throw new IllegalStateException("Unexpected non-fixture code");
                if(!first)json.append(',');first=false;json.append('"').append(code).append("\":\"").append(r.getLong(2)).append('"');
            }
        }
        return json.append('}').toString();
    }
    public static void main(String[] args)throws Exception{
        if(!env("QA_SCOPE").equals("OWN_NEW_D03_CATALOG_STACK"))throw new IllegalStateException("New fixture scope required");
        String url=env("DB_URL");
        if(!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/clinic_management_db(?:\\?.*)?")||url.contains(":3306/")||url.contains(":3307/"))throw new IllegalStateException("Refusing shared DB URL");
        try(var connection=DriverManager.getConnection(url,env("DB_USERNAME"),env("DB_PASSWORD"))){
            db=connection;
            if(!db.getMetaData().getDatabaseProductVersion().startsWith("8.4."))throw new IllegalStateException("MySQL 8.4 required");
            var f=Flyway.configure().dataSource(url,env("DB_USERNAME"),env("DB_PASSWORD"))
                    .locations("filesystem:"+Path.of(args[1]).toAbsolutePath().toString().replace('\\','/')).cleanDisabled(true).baselineOnMigrate(false).validateMigrationNaming(true).load();
            var migrated=f.migrate();
            if(!f.validateWithResult().validationSuccessful||f.info().applied().length!=2||!f.info().current().getVersion().getVersion().equals("2"))throw new IllegalStateException("V1/V2 mismatch");
            if(args[0].equals("ensure")){
                db.setAutoCommit(false);
                try{
                    users();long s1=specialty("D03_QA_S1_ACTIVE","QA D03 Active Specialty One",true);
                    long s2=specialty("D03_QA_S2_ACTIVE","QA D03 Active Specialty Two",true);
                    specialty("D03_QA_S3_INACTIVE","QA D03 Inactive Specialty",false);
                    doctor("DOCTOR_LINKED",s1,"D03_QA_DOC_ACTIVE",true);
                    doctor("DOCTOR_INACTIVE",s2,"D03_QA_DOC_INACTIVE",false);
                    db.commit();
                }catch(Exception e){db.rollback();throw e;}
                db.setAutoCommit(true);
            }else if(args[0].equals("rollback-probe")){
                String before=fingerprint();
                if(count("SELECT COUNT(*) FROM specialties WHERE code='D03_QA_TX_ROLLBACK'")!=0)throw new IllegalStateException("Rollback probe key already exists; refusing overwrite");
                db.setAutoCommit(false);
                try{
                    specialty("D03_QA_TX_ROLLBACK","QA D03 Uncommitted Rollback Probe",true);
                    try{
                        doctor("DOCTOR_ELIGIBLE",9223372036854775806L,"D03_QA_TX_REJECTED",true);
                        throw new IllegalStateException("Expected FK failure after initial DML");
                    }catch(SQLException expected){if(expected.getErrorCode()!=1452)throw expected;}
                }finally{db.rollback();db.setAutoCommit(true);}
                if(!before.equals(fingerprint())||count("SELECT COUNT(*) FROM specialties WHERE code='D03_QA_TX_ROLLBACK'")!=0)
                    throw new IllegalStateException("Rollback did not restore original catalog data");
            }else if(!List.of("snapshot","verify").contains(args[0]))throw new IllegalArgumentException("Unsupported fixture action");
            if(count("SELECT COUNT(*) FROM doctors d JOIN users u ON u.id=d.user_id WHERE u.role<>'DOCTOR' OR u.status<>'ACTIVE'")!=0
                    ||count("SELECT COUNT(*) FROM doctors d JOIN specialties s ON s.id=d.specialty_id WHERE d.is_active=1 AND s.is_active=0")!=0)
                throw new IllegalStateException("Invalid doctor relationship/state");
            long eligible=userId("DOCTOR_ELIGIBLE");
            if(count("SELECT COUNT(*) FROM doctors WHERE user_id="+eligible)!=0)throw new IllegalStateException("Required eligible user is linked");
            if(args[0].equals("verify")){
                if(count("SELECT COUNT(*) FROM specialties WHERE is_active=1")<2||count("SELECT COUNT(*) FROM specialties WHERE is_active=0")<1
                        ||count("SELECT COUNT(*) FROM doctors WHERE is_active=1")<1||count("SELECT COUNT(*) FROM doctors WHERE is_active=0")<1)
                    throw new IllegalStateException("Incomplete final fixture states");
                users();
            }
            var json=new StringBuilder("{\"users\":{");boolean first=true;
            for(String actor:ACTORS){if(!first)json.append(',');first=false;json.append('"').append(actor).append("\":\"").append(userId(actor)).append('"');}
            json.append("},\"specialties\":").append(catalogIds("specialties","code"))
                    .append(",\"doctors\":").append(catalogIds("doctors","doctor_code"))
                    .append(",\"counts\":{\"users\":").append(count("SELECT COUNT(*) FROM users"))
                    .append(",\"specialties\":").append(count("SELECT COUNT(*) FROM specialties"))
                    .append(",\"doctors\":").append(count("SELECT COUNT(*) FROM doctors"))
                    .append("},\"fingerprint\":\"").append(fingerprint()).append("\",\"migrations_executed\":").append(migrated.migrationsExecuted)
                    .append(",\"database\":\"").append(db.getCatalog()).append("\",\"mysql_version\":\"").append(db.getMetaData().getDatabaseProductVersion()).append("\"}");
            System.out.println("D03_FIXTURE_RESULT="+json);
        }
    }
}
