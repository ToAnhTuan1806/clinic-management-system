package com.clinicmanagement.dto;

import jakarta.validation.constraints.*;

public record DoctorPatchRequest(@Positive Long specialtyId,
        @Pattern(regexp = CatalogValues.CODE_PATTERN) String doctorCode,
        @Size(max = 100) String licenseNumber, @Size(max = 5000) String biography, Boolean isActive) {
    public DoctorPatchRequest { doctorCode = CatalogValues.code(doctorCode); }
}
