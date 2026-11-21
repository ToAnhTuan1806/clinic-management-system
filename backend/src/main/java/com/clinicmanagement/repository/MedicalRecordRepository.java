package com.clinicmanagement.repository;

import com.clinicmanagement.entity.MedicalRecord;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MedicalRecordRepository extends JpaRepository<MedicalRecord, Long> {
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
