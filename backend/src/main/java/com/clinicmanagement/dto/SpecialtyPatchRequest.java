package com.clinicmanagement.dto;

import jakarta.validation.constraints.*;

public record SpecialtyPatchRequest(@Pattern(regexp = CatalogValues.CODE_PATTERN) String code,
        @Size(min = 1, max = 120) String name, @Size(max = 5000) String description, Boolean isActive) {
    public SpecialtyPatchRequest {
        code = CatalogValues.code(code);
        name = CatalogValues.trim(name);
    }
}
