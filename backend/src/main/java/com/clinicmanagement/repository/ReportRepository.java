package com.clinicmanagement.repository;

import com.clinicmanagement.entity.Appointment;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface ReportRepository extends Repository<Appointment, Long> {
    interface DailyVisitRow {
        LocalDate getVisitDate();
        long getTotalAppointments();
        long getCheckedInCount();
        long getCompletedCount();
        long getCancelledCount();
        long getNoShowCount();
    }

    interface DoctorVisitRow {
        Long getDoctorId();
        String getDoctorCode();
        String getDoctorName();
        String getSpecialtyName();
        long getTotalAppointments();
        long getCheckedInCount();
        long getCompletedCount();
    }

    interface SpecialtyVisitRow {
        Long getSpecialtyId();
        String getSpecialtyCode();
        String getSpecialtyName();
        long getTotalAppointments();
        long getCheckedInCount();
        long getCompletedCount();
    }

    @Query(value = """
            SELECT CAST(TIMESTAMPADD(HOUR, 7, a.start_at_utc) AS DATE) AS visitDate,
                   COUNT(*) AS totalAppointments,
                   SUM(CASE WHEN a.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checkedInCount,
                   SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedCount,
                   SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelledCount,
                   SUM(CASE WHEN a.status = 'NO_SHOW' THEN 1 ELSE 0 END) AS noShowCount
            FROM appointments a
            JOIN doctors d ON d.id = a.doctor_id
            WHERE a.start_at_utc >= :start AND a.start_at_utc < :end
              AND (:doctorUserId IS NULL OR d.user_id = :doctorUserId)
            GROUP BY CAST(TIMESTAMPADD(HOUR, 7, a.start_at_utc) AS DATE)
            ORDER BY visitDate ASC
            """, nativeQuery = true)
    List<DailyVisitRow> dailyVisits(
            @Param("start") Instant start,
            @Param("end") Instant end,
            @Param("doctorUserId") Long doctorUserId);

    @Query("""
            select d.id as doctorId,
                   d.doctorCode as doctorCode,
                   u.fullName as doctorName,
                   s.name as specialtyName,
                   count(a) as totalAppointments,
                   sum(case when a.checkedInAt is not null then 1L else 0L end) as checkedInCount,
                   sum(case when a.status = com.clinicmanagement.entity.AppointmentStatus.COMPLETED then 1L else 0L end) as completedCount
            from Appointment a
            join a.doctor d
            join d.user u
            join d.specialty s
            where a.startAt >= :start and a.startAt < :end
              and (:doctorUserId is null or u.id = :doctorUserId)
            group by d.id, d.doctorCode, u.fullName, s.name
            order by count(a) desc, d.id asc
            """)
    List<DoctorVisitRow> visitsByDoctor(
            @Param("start") Instant start,
            @Param("end") Instant end,
            @Param("doctorUserId") Long doctorUserId);

    @Query("""
            select s.id as specialtyId,
                   s.code as specialtyCode,
                   s.name as specialtyName,
                   count(a) as totalAppointments,
                   sum(case when a.checkedInAt is not null then 1L else 0L end) as checkedInCount,
                   sum(case when a.status = com.clinicmanagement.entity.AppointmentStatus.COMPLETED then 1L else 0L end) as completedCount
            from Appointment a
            join a.doctor d
            join d.user u
            join d.specialty s
            where a.startAt >= :start and a.startAt < :end
              and (:doctorUserId is null or u.id = :doctorUserId)
            group by s.id, s.code, s.name
            order by count(a) desc, s.id asc
            """)
    List<SpecialtyVisitRow> visitsBySpecialty(
            @Param("start") Instant start,
            @Param("end") Instant end,
            @Param("doctorUserId") Long doctorUserId);
}
