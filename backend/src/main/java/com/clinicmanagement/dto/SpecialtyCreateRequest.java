package com.clinicmanagement.dto;

import jakarta.validation.constraints.*;

public record SpecialtyCreateRequest(@NotBlank @Pattern(regexp = CatalogValues.CODE_PATTERN) String code,
        @NotBlank @Size(max = 120) String name, @Size(max = 5000) String description, Boolean isActive) {
    public SpecialtyCreateRequest {
        code = CatalogValues.code(code);
        name = CatalogValues.trim(name);
    }
}
