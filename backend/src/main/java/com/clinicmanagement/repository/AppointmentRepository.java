package com.clinicmanagement.repository;

import com.clinicmanagement.entity.Appointment;
import com.clinicmanagement.entity.AppointmentStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface AppointmentRepository extends JpaRepository<Appointment, Long>, JpaSpecificationExecutor<Appointment> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Appointment a where a.id = :id")
    Optional<Appointment> findLockedForExamination(@Param("id") Long id);

    @EntityGraph(attributePaths = {"patient", "doctor", "doctor.user", "doctor.specialty", "schedule", "createdBy", "cancelledBy", "rescheduledBy", "previousSchedule", "confirmedBy", "checkedInBy", "noShowBy"})
    Optional<Appointment> findById(Long id);

    @EntityGraph(attributePaths = {"patient", "doctor", "doctor.user", "doctor.specialty", "schedule", "createdBy", "cancelledBy", "rescheduledBy", "previousSchedule", "confirmedBy", "checkedInBy", "noShowBy"})
    Optional<Appointment> findByCreatedByIdAndRequestKey(Long createdById, String requestKey);

    boolean existsByAppointmentCode(String appointmentCode);

    @Query("SELECT COUNT(a) > 0 FROM Appointment a WHERE a.doctor.id = :doctorId AND a.startAt = :startAt AND a.status <> :excludedStatus")
    boolean existsByDoctorIdAndStartAtAndStatusNot(
            @Param("doctorId") Long doctorId,
            @Param("startAt") Instant startAt,
            @Param("excludedStatus") AppointmentStatus excludedStatus);

    @Query("SELECT COUNT(a) > 0 FROM Appointment a WHERE a.doctor.id = :doctorId AND a.startAt = :startAt AND a.status <> :excludedStatus AND a.id <> :appointmentId")
    boolean existsByDoctorIdAndStartAtAndStatusNotAndIdNot(
            @Param("doctorId") Long doctorId,
            @Param("startAt") Instant startAt,
            @Param("excludedStatus") AppointmentStatus excludedStatus,
            @Param("appointmentId") Long appointmentId);

    @Query("SELECT COUNT(a) > 0 FROM Appointment a WHERE a.schedule.id = :scheduleId AND a.status <> :excludedStatus")
    boolean existsByScheduleIdAndStatusNot(
            @Param("scheduleId") Long scheduleId,
            @Param("excludedStatus") AppointmentStatus excludedStatus);

    @Query("SELECT a FROM Appointment a WHERE a.schedule.id = :scheduleId AND a.status <> :excludedStatus")
    List<Appointment> findByScheduleIdAndStatusNot(
            @Param("scheduleId") Long scheduleId,
            @Param("excludedStatus") AppointmentStatus excludedStatus);

    @Query("SELECT a FROM Appointment a WHERE a.doctor.id = :doctorId AND a.status <> :excludedStatus")
    List<Appointment> findByDoctorIdAndStatusNot(
            @Param("doctorId") Long doctorId,
            @Param("excludedStatus") AppointmentStatus excludedStatus);

    @Override
    @EntityGraph(attributePaths = {"patient", "doctor", "doctor.user", "doctor.specialty", "schedule", "createdBy", "cancelledBy", "rescheduledBy", "previousSchedule", "confirmedBy", "checkedInBy", "noShowBy"})
    Page<Appointment> findAll(Specification<Appointment> spec, Pageable pageable);
}
