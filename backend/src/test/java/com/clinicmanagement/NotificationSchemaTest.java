package com.clinicmanagement;

import static org.assertj.core.api.Assertions.*;

import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Tag("mysql")
class NotificationSchemaTest {
    static Flyway flyway(String variable, String target) {
        String url = System.getenv(variable);
        MySqlTestDatabase.requireIsolatedUrl(url);
        return Flyway.configure().dataSource(url, System.getenv("DB_USERNAME"), System.getenv("DB_PASSWORD"))
                .locations("classpath:db/migration").target(target).cleanDisabled(true).baselineOnMigrate(false).load();
    }

    static String key(long appointment, long version, String event) {
        return "appointment:" + appointment + ":version:" + version + ":event:" + event;
    }

    static void insert(JdbcTemplate db, long recipient, long appointment, String event, String key) {
        db.update("""
                INSERT INTO notifications(recipient_user_id,appointment_id,event_type,event_key,title,body,created_at)
                VALUES(?,?,?,?, 'Lịch khám mô phỏng 🧪','Thông báo điều phối giả lập','2026-12-31 17:00:00.123456')
                """,recipient,appointment,event,key);
    }

    @Test
    void freshConstraintsDedupTransactionsUnicodeAndPagination() throws Exception {
        var f = flyway("D13_FRESH_URL", "12");
        assertThat(f.migrate().migrationsExecuted).isEqualTo(12);
        assertThat(f.validateWithResult().validationSuccessful).isTrue();
        var db = new JdbcTemplate(f.getConfiguration().getDataSource());
        PrescriptionSchemaTest.seed(db);
        String created = key(4,0,"APPOINTMENT_CREATED");
        insert(db,50,4,"APPOINTMENT_CREATED",created);
        reject(() -> insert(db,50,4,"APPOINTMENT_CREATED",created),1062);
        insert(db,3,4,"APPOINTMENT_CREATED",created); // Same event, different intended recipient.
        insert(db,50,4,"APPOINTMENT_RESCHEDULED",key(4,1,"APPOINTMENT_RESCHEDULED"));
        insert(db,50,4,"APPOINTMENT_RESCHEDULED",key(4,2,"APPOINTMENT_RESCHEDULED"));
        assertThat(key(Long.MAX_VALUE,Long.MAX_VALUE,"APPOINTMENT_RESCHEDULED")).hasSize(89);
        reject(() -> insert(db,999999,4,"APPOINTMENT_CREATED",created),1452);
        reject(() -> insert(db,50,999999,"APPOINTMENT_CREATED",key(999999,0,"APPOINTMENT_CREATED")),1452);
        reject(() -> insert(db,50,4,"RECORD_RELEASED","invalid-type"),3819);
        reject(() -> insert(db,50,4,"APPOINTMENT_CREATED"," "),3819);
        reject(() -> db.update("UPDATE notifications SET read_at='2026-01-01'"),3819);
        reject(() -> db.update("DELETE FROM users WHERE id=50"),1451);
        reject(() -> db.update("UPDATE users SET id=51 WHERE id=50"),1451);
        assertThat(db.queryForObject("SELECT title FROM notifications WHERE event_key=? AND recipient_user_id=50",String.class,created)).isEqualTo("Lịch khám mô phỏng 🧪");
        assertThat(db.update("UPDATE notifications SET read_at='2026-12-31 17:00:00.123456' WHERE recipient_user_id=50 AND event_key=?",created)).isOne();
        assertThat(db.update("UPDATE notifications SET read_at='2026-12-31 18:00:00' WHERE recipient_user_id=1 AND event_key=?",created)).isZero();
        db.update("""
                INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,start_at_utc,end_at_utc,status,request_key,request_fingerprint,created_at,updated_at)
                VALUES(5,'D13-5',1,1,1,1,'2026-12-31 17:00:00','2026-12-31 17:30:00','PENDING','d13-5',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))
                ""","a".repeat(64));
        insert(db,50,5,"APPOINTMENT_CREATED",key(5,0,"APPOINTMENT_CREATED"));
        reject(() -> db.update("DELETE FROM appointments WHERE id=5"),1451);
        reject(() -> db.update("UPDATE appointments SET id=6 WHERE id=5"),1451);
        var transaction = new TransactionTemplate(new DataSourceTransactionManager(db.getDataSource()));
        var before = db.queryForList("SELECT * FROM appointments ORDER BY id");
        long count = db.queryForObject("SELECT COUNT(*) FROM notifications",Long.class);
        reject(() -> transaction.executeWithoutResult(status -> {
            db.update("UPDATE appointments SET status='CONFIRMED',version=version+1 WHERE id=5");
            insert(db,999999,5,"APPOINTMENT_CONFIRMED",key(5,1,"APPOINTMENT_CONFIRMED"));
        }),1452);
        assertThat(db.queryForList("SELECT * FROM appointments ORDER BY id")).isEqualTo(before);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM notifications",Long.class)).isEqualTo(count);
        var barrier = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            Callable<Boolean> race = () -> {
                barrier.await(10,TimeUnit.SECONDS);
                try { insert(db,50,5,"APPOINTMENT_CONFIRMED",key(5,1,"APPOINTMENT_CONFIRMED")); return true; }
                catch (org.springframework.dao.DuplicateKeyException expected) { return false; }
            };
            var a = pool.submit(race); var b = pool.submit(race);
            assertThat(List.of(a.get(30,TimeUnit.SECONDS),b.get(30,TimeUnit.SECONDS))).containsExactlyInAnyOrder(true,false);
        }
        transaction.executeWithoutResult(status -> {
            for (int i=10;i<1010;i++) insert(db,50,5,"APPOINTMENT_RESCHEDULED",key(5,i,"APPOINTMENT_RESCHEDULED"));
        });
        String page = "SELECT id FROM notifications WHERE recipient_user_id=50 ORDER BY created_at DESC,id DESC LIMIT 10";
        var first = db.queryForList(page,Long.class);
        var second = db.queryForList("SELECT id FROM notifications WHERE recipient_user_id=50 AND created_at='2026-12-31 17:00:00.123456' AND id<? ORDER BY created_at DESC,id DESC LIMIT 10",Long.class,first.getLast());
        assertThat(first).hasSize(10).doesNotContainAnyElementsOf(second);
        assertThat(second).hasSize(10);
        String plan = db.queryForObject("EXPLAIN ANALYZE "+page,String.class);
        assertThat(plan).contains("ix_notifications_recipient_created_id");
        System.out.println("D13_NOTIFICATION_PAGE_PLAN="+plan);
        System.out.println("D13_UNREAD_PLAN="+db.queryForObject("EXPLAIN ANALYZE SELECT COUNT(*) FROM notifications WHERE recipient_user_id=50 AND read_at IS NULL",String.class));
        assertThat(db.queryForList("SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='notifications'",String.class))
                .containsExactlyInAnyOrder("PRIMARY","uk_notifications_recipient_event","ix_notifications_recipient_created_id","ix_notifications_appointment");
        assertThat(f.migrate().migrationsExecuted).isZero();
        System.out.println("D13_FRESH_FLYWAY_CHECKSUM="+f.info().current().getChecksum());
    }

    @Test
    void upgradePreservesV11DataHistoryAndDoesNotBackfill() {
        var old = flyway("D13_UPGRADE_URL","11");
        assertThat(old.migrate().migrationsExecuted).isEqualTo(11);
        var db = new JdbcTemplate(old.getConfiguration().getDataSource());
        PrescriptionSchemaTest.seed(db);
        db.update("INSERT INTO prescriptions(id,medical_record_id,created_by,created_at,updated_at) VALUES(1,4,1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))");
        db.update("INSERT INTO prescription_items(prescription_id,medication_name,quantity,dosage,frequency,duration_days,sort_order) VALUES(1,'Thuốc giả lập',1,'Giả lập','Giả lập',1,0)");
        var tables=List.of("users","specialties","doctors","patients","doctor_schedules","appointments","medical_records","prescriptions","prescription_items","flyway_schema_history");
        var before=tables.stream().map(t -> db.queryForList("SELECT * FROM "+t)).toList();
        var f=flyway("D13_UPGRADE_URL","12");
        assertThat(f.migrate().migrationsExecuted).isOne();
        assertThat(f.validateWithResult().validationSuccessful).isTrue();
        for (int i=0;i<tables.size();i++) {
            String filter=tables.get(i).equals("flyway_schema_history") ? " WHERE version<>'12'" : "";
            assertThat(db.queryForList("SELECT * FROM "+tables.get(i)+filter)).as(tables.get(i)).isEqualTo(before.get(i));
        }
        assertThat(db.queryForObject("SELECT COUNT(*) FROM notifications",Long.class)).isZero();
        assertThat(f.migrate().migrationsExecuted).isZero();
        System.out.println("D13_UPGRADE_FLYWAY_CHECKSUM="+f.info().current().getChecksum());
    }

    static void reject(Runnable sql,int code) {
        assertThatThrownBy(sql::run).satisfies(error -> {
            Throwable root=error; while(root.getCause()!=null)root=root.getCause();
            assertThat(root).isInstanceOf(SQLException.class);
            assertThat(((SQLException)root).getErrorCode()).isEqualTo(code);
        });
    }
}
