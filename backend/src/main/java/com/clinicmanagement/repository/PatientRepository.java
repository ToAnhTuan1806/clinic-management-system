package com.clinicmanagement.repository;

import com.clinicmanagement.entity.Patient;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface PatientRepository extends JpaRepository<Patient, Long>, JpaSpecificationExecutor<Patient> {
    boolean existsByPatientCode(String patientCode);
    boolean existsByPatientCodeAndIdNot(String code, Long id);
    boolean existsByUserId(Long userId);
    boolean existsByUserIdAndIdNot(Long userId, Long id);

    @Override
    @EntityGraph(attributePaths = {"user"})
    Page<Patient> findAll(Specification<Patient> specification, Pageable pageable);

    @Override
    @EntityGraph(attributePaths = {"user"})
    Optional<Patient> findOne(Specification<Patient> specification);

    @EntityGraph(attributePaths = {"user"})
    Optional<Patient> findByUserId(Long userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Patient p where p.id = :id")
    Optional<Patient> findLocked(@Param("id") Long id);
}
