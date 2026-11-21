package com.clinicmanagement.repository;

import com.clinicmanagement.entity.MedicalRecord;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import java.time.Instant;

public interface MedicalRecordRepository extends JpaRepository<MedicalRecord, Long> {
    interface HistoryRow {
        Long getId();
        Long getAppointmentId();
        Long getDoctorId();
        Instant getCompletedAt();
        Instant getReleasedAt();
        Long getVersion();
    }

    @Query(value = """
            select r.id as id, a.id as appointmentId, a.doctor.id as doctorId,
                   r.completedAt as completedAt, r.releasedAt as releasedAt, r.version as version
            from MedicalRecord r join r.appointment a
            where a.patient.id = :patientId and a.status = com.clinicmanagement.entity.AppointmentStatus.COMPLETED
              and r.completedAt is not null
              and (:doctorUserId is null or a.doctor.user.id = :doctorUserId)
              and (:releasedOnly = false or (r.releasedAt is not null and r.releasedBy is not null))
            order by r.completedAt desc, r.id desc
            """, countQuery = """
            select count(r) from MedicalRecord r join r.appointment a
            where a.patient.id = :patientId and a.status = com.clinicmanagement.entity.AppointmentStatus.COMPLETED
              and r.completedAt is not null
              and (:doctorUserId is null or a.doctor.user.id = :doctorUserId)
              and (:releasedOnly = false or (r.releasedAt is not null and r.releasedBy is not null))
            """)
    Page<HistoryRow> history(@Param("patientId") Long patientId, @Param("doctorUserId") Long doctorUserId,
                            @Param("releasedOnly") boolean releasedOnly, Pageable pageable);
    @Override
    @EntityGraph(attributePaths = "appointment")
    Optional<MedicalRecord> findById(Long id);

    @EntityGraph(attributePaths = "appointment")
    Optional<MedicalRecord> findByAppointmentId(Long appointmentId);

    @Query("select r.appointment.id from MedicalRecord r where r.id = :id")
    Optional<Long> findAppointmentId(@Param("id") Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from MedicalRecord r where r.id = :id")
    Optional<MedicalRecord> findLocked(@Param("id") Long id);
}
