package com.clinicmanagement.dto;

import jakarta.validation.constraints.*;

public record DoctorCreateRequest(@NotNull @Positive Long userId, @NotNull @Positive Long specialtyId,
        @NotBlank @Pattern(regexp = CatalogValues.CODE_PATTERN) String doctorCode,
        @Size(max = 100) String licenseNumber, @Size(max = 5000) String biography, Boolean isActive) {
    public DoctorCreateRequest { doctorCode = CatalogValues.code(doctorCode); }
}
