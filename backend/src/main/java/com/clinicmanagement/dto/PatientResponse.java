package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Patient;
import com.clinicmanagement.entity.Sex;
import java.time.LocalDate;

public record PatientResponse(
        String id,
        String patientCode,
        String fullName,
        LocalDate dateOfBirth,
        Sex sex,
        String phone,
        String address,
        boolean isActive,
        String userId
) {
    public static PatientResponse from(Patient patient) {
        return new PatientResponse(
                patient.getId() != null ? patient.getId().toString() : null,
                patient.getPatientCode(),
                patient.getFullName(),
                patient.getDateOfBirth(),
                patient.getSex(),
                patient.getPhone(),
                patient.getAddress(),
                patient.isActive(),
                patient.getUser() != null && patient.getUser().getId() != null ? patient.getUser().getId().toString() : null
        );
    }
}
