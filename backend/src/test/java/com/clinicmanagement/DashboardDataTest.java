package com.clinicmanagement;

import static org.assertj.core.api.Assertions.*;
import java.sql.Timestamp;
import java.time.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;

@Tag("mysql")
class DashboardDataTest {
    @Test
    void vietnamStartDateStatusPatientDoctorBoundariesAndJoinFanout() {
        var f=NotificationSchemaTest.flyway("D13_DASHBOARD_URL","12");
        f.migrate();
        assertThat(f.validateWithResult().validationSuccessful).isTrue();
        var db=new JdbcTemplate(f.getConfiguration().getDataSource());
        PrescriptionSchemaTest.seed(db);
        String[] times={"2025-12-31 16:59:59.999999","2025-12-31 17:00:00","2026-01-31 16:59:59.999999","2026-01-31 17:00:00"};
        for(int i=1;i<=4;i++) db.update("UPDATE appointments SET start_at_utc=?,end_at_utc=TIMESTAMPADD(MINUTE,30,?),created_at='2024-01-01',updated_at='2024-01-01' WHERE id=?",times[i-1],times[i-1],i);
        String[] states={"PENDING","CONFIRMED","CHECKED_IN","CANCELLED","NO_SHOW","COMPLETED","CANCELLED"};
        for(int id=5;id<=11;id++) {
            String time=id==10 ? "2026-12-31 16:59:59.999999" : id==11 ? "2026-12-31 17:00:00" : "2026-01-15 0"+(id-4)+":00:00";
            int doctor=id%2+1,patient=(id-5)%3+1;
            db.update("""
                    INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,start_at_utc,end_at_utc,status,request_key,request_fingerprint,created_at,updated_at)
                    VALUES(?,?,?,?,?,1,?,TIMESTAMPADD(MINUTE,30,?),?,?,?,'2024-01-01','2024-01-01')
                    """,id,"D13DASH"+id,patient,doctor,doctor,time,time,states[id-5],"dash-"+id,"a".repeat(64));
        }
        var zone=ZoneId.of("Asia/Ho_Chi_Minh");
        Timestamp start=Timestamp.from(LocalDate.of(2026,1,1).atStartOfDay(zone).toInstant());
        Timestamp end=Timestamp.from(LocalDate.of(2026,2,1).atStartOfDay(zone).toInstant());
        assertThat(start.toInstant()).isEqualTo(Instant.parse("2025-12-31T17:00:00Z"));
        String range=" FROM appointments WHERE start_at_utc>=? AND start_at_utc<?";
        assertThat(db.queryForObject("SELECT COUNT(*)"+range,Long.class,start,end)).isEqualTo(7);
        assertThat(db.queryForObject("SELECT COUNT(DISTINCT patient_id)"+range,Long.class,start,end)).isEqualTo(3);
        var status=db.queryForList("SELECT status,COUNT(*) AS total"+range+" GROUP BY status",start,end);
        assertThat(status).hasSize(6);
        assertThat(db.queryForObject("SELECT COUNT(*)"+range+" AND status='COMPLETED'",Long.class,start,end)).isEqualTo(2);
        for(String state:new String[]{"PENDING","CONFIRMED","CHECKED_IN","CANCELLED","NO_SHOW"})
            assertThat(db.queryForObject("SELECT COUNT(*)"+range+" AND status=?",Long.class,start,end,state)).isEqualTo(1);
        assertThat(db.queryForObject("SELECT COUNT(*)"+range+" AND doctor_id=1",Long.class,start,end)).isEqualTo(3);
        assertThat(db.queryForObject("SELECT COUNT(*)"+range+" AND doctor_id=2",Long.class,start,end)).isEqualTo(4);
        for(int year:new int[]{2025,2026,2027}) {
            Timestamp a=Timestamp.from(LocalDate.of(year,1,1).atStartOfDay(zone).toInstant());
            Timestamp b=Timestamp.from(LocalDate.of(year+1,1,1).atStartOfDay(zone).toInstant());
            assertThat(db.queryForObject("SELECT COUNT(*)"+range,Long.class,a,b)).isEqualTo(year==2026 ? 9:1);
        }
        assertThat(db.queryForObject("SELECT COUNT(*)"+range,Long.class,end,Timestamp.from(LocalDate.of(2026,3,1).atStartOfDay(zone).toInstant()))).isEqualTo(1);
        NotificationSchemaTest.insert(db,3,2,"APPOINTMENT_CREATED",NotificationSchemaTest.key(2,0,"APPOINTMENT_CREATED"));
        NotificationSchemaTest.insert(db,4,2,"APPOINTMENT_CREATED",NotificationSchemaTest.key(2,0,"APPOINTMENT_CREATED"));
        db.update("INSERT INTO prescriptions(id,medical_record_id,created_by,created_at,updated_at) VALUES(1,2,1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))");
        for(int i=0;i<2;i++) db.update("INSERT INTO prescription_items(prescription_id,medication_name,quantity,dosage,frequency,duration_days,sort_order) VALUES(1,'Giả lập',1,'Giả lập','Giả lập',1,?)",i);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM appointments a JOIN notifications n ON n.appointment_id=a.id JOIN medical_records m ON m.appointment_id=a.id JOIN prescriptions p ON p.medical_record_id=m.id JOIN prescription_items i ON i.prescription_id=p.id WHERE a.id=2",Long.class)).isEqualTo(4);
        assertThat(db.queryForObject("SELECT COUNT(*)"+range,Long.class,start,end)).isEqualTo(7);
        assertThat(db.queryForList("SHOW TABLES",String.class)).doesNotContain("dashboard","dashboard_stats");
        System.out.println("D13_DASHBOARD_STATUS_PLAN="+db.queryForObject("EXPLAIN ANALYZE SELECT status,COUNT(*)"+range+" GROUP BY status",String.class,start,end));
        System.out.println("D13_DASHBOARD_DOCTOR_PLAN="+db.queryForObject("EXPLAIN ANALYZE SELECT COUNT(*)"+range+" AND doctor_id=1",String.class,start,end));
    }
}
