package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Sex;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

public record PatientPatchRequest(
        @Positive Long userId,
        @Pattern(regexp = CatalogValues.CODE_PATTERN) String patientCode,
        @Size(max = 120) String fullName,
        @PastOrPresent LocalDate dateOfBirth,
        Sex sex,
        @Size(max = 24) String phone,
        @Size(max = 255) String address,
        Boolean isActive
) {
    public PatientPatchRequest {
        patientCode = CatalogValues.code(patientCode);
        fullName = CatalogValues.trim(fullName);
        phone = CatalogValues.optionalText(phone);
        address = CatalogValues.optionalText(address);
    }
}
