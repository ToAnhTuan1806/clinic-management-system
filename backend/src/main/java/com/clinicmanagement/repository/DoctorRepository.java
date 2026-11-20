package com.clinicmanagement.repository;

import com.clinicmanagement.entity.Doctor;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface DoctorRepository extends JpaRepository<Doctor, Long>, JpaSpecificationExecutor<Doctor> {
    boolean existsByDoctorCodeAndIdNot(String code, Long id);
    boolean existsByLicenseNumberAndIdNot(String license, Long id);
    boolean existsByUserId(Long id);
    boolean existsBySpecialtyIdAndActiveTrue(Long id);

    @Override @EntityGraph(attributePaths = {"user", "specialty"})
    Page<Doctor> findAll(Specification<Doctor> specification, Pageable pageable);

    @Override @EntityGraph(attributePaths = {"user", "specialty"})
    Optional<Doctor> findOne(Specification<Doctor> specification);

    interface Links {
        Long getUserId();
        Long getSpecialtyId();
    }

    @Query("select d.user.id as userId, d.specialty.id as specialtyId from Doctor d where d.id = :id")
    Optional<Links> findLinks(@Param("id") Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from Doctor d where d.id = :id")
    Optional<Doctor> findLocked(@Param("id") Long id);
}
