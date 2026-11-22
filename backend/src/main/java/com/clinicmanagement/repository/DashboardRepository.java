package com.clinicmanagement.repository;

import com.clinicmanagement.entity.Appointment;
import com.clinicmanagement.entity.AppointmentStatus;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

public interface DashboardRepository extends Repository<Appointment, Long> {
    interface StatusCount {
        AppointmentStatus getStatus();
        long getTotal();
        long getCheckedIn();
    }
    @Query("""
            select a.status as status, count(a) as total,
                   sum(case when a.checkedInAt is not null then 1L else 0L end) as checkedIn
            from Appointment a where a.startAt >= :start and a.startAt < :end
              and (:doctorUserId is null or a.doctor.user.id = :doctorUserId)
            group by a.status
            """)
    List<StatusCount> counts(Instant start, Instant end, Long doctorUserId);

    @Query("""
            select count(distinct a.patient.id) from Appointment a
            where a.startAt >= :start and a.startAt < :end
              and (:doctorUserId is null or a.doctor.user.id = :doctorUserId)
            """)
    long uniquePatients(Instant start, Instant end, Long doctorUserId);
}
