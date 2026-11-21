package com.clinicmanagement.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ProfilePatchRequest(
        @NotBlank @Size(max = 120) String fullName,
        @Size(max = 24) String phone,
        @Size(max = 255) String address) {

    public ProfilePatchRequest(String fullName) {
        this(fullName, null, null);
    }

    public ProfilePatchRequest {
        fullName = fullName == null ? null : fullName.trim();
        phone = CatalogValues.optionalText(phone);
        address = CatalogValues.optionalText(address);
    }
}
