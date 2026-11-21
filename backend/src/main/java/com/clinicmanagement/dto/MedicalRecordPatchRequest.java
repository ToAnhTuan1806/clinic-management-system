package com.clinicmanagement.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.annotation.JsonDeserialize;

public record MedicalRecordPatchRequest(
        @JsonDeserialize(using = MedicalRecordCompletionRequest.VersionDeserializer.class)
        @NotNull @PositiveOrZero Long expectedVersion,
        @Size(max = 5000) String symptoms,
        @Size(max = 5000) String diagnosis,
        @Size(max = 5000) String notes,
        @Size(max = 5000) String conclusion) {

    public boolean hasChanges() {
        return symptoms != null || diagnosis != null || notes != null || conclusion != null;
    }

    @Override
    public String toString() {
        return "MedicalRecordPatchRequest[clinical fields redacted]";
    }
}
