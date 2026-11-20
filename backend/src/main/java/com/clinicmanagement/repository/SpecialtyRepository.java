package com.clinicmanagement.repository;

import com.clinicmanagement.entity.Specialty;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface SpecialtyRepository extends JpaRepository<Specialty, Long>, JpaSpecificationExecutor<Specialty> {
    boolean existsByCodeAndIdNot(String code, Long id);
    boolean existsByNameIgnoreCaseAndIdNot(String name, Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Specialty s where s.id = :id")
    Optional<Specialty> findLocked(@Param("id") Long id);
}
