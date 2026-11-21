package com.clinicmanagement.repository;

import com.clinicmanagement.entity.DoctorSchedule;
import com.clinicmanagement.entity.ScheduleStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DoctorScheduleRepository extends JpaRepository<DoctorSchedule, Long>, JpaSpecificationExecutor<DoctorSchedule> {

    @Override
    @EntityGraph(attributePaths = {"doctor", "doctor.user", "doctor.specialty"})
    Page<DoctorSchedule> findAll(Specification<DoctorSchedule> spec, Pageable pageable);

    @Override
    @EntityGraph(attributePaths = {"doctor", "doctor.user", "doctor.specialty"})
    Optional<DoctorSchedule> findById(Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from DoctorSchedule s where s.id = :id")
    Optional<DoctorSchedule> findLocked(@Param("id") Long id);

    @Query("select count(s) > 0 from DoctorSchedule s where s.doctor.id = :doctorId and s.status = :status "
            + "and s.startAt < :endAt and s.endAt > :startAt and (:excludeId is null or s.id <> :excludeId)")
    boolean existsOverlapping(
            @Param("doctorId") Long doctorId,
            @Param("status") ScheduleStatus status,
            @Param("startAt") Instant startAt,
            @Param("endAt") Instant endAt,
            @Param("excludeId") Long excludeId
    );

    @EntityGraph(attributePaths = {"doctor", "doctor.user"})
    List<DoctorSchedule> findByDoctorIdAndStatusAndWorkDateBetweenOrderByStartAtAsc(
            Long doctorId,
            ScheduleStatus status,
            LocalDate fromDate,
            LocalDate toDate
    );
}
