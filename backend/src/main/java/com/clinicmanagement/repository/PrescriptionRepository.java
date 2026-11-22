package com.clinicmanagement.repository;

import com.clinicmanagement.entity.Prescription;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface PrescriptionRepository extends JpaRepository<Prescription, Long> {
    @EntityGraph(attributePaths = {"items", "medicalRecord"})
    Optional<Prescription> findByMedicalRecordId(Long medicalRecordId);

    boolean existsByMedicalRecordId(Long medicalRecordId);
}
