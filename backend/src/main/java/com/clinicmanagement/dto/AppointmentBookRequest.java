package com.clinicmanagement.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public record AppointmentBookRequest(
        @NotBlank(message = "Schedule ID is required")
        String scheduleId,

        @NotNull(message = "Start time is required")
        Instant startAt,

        @NotBlank(message = "Request key is required")
        @Size(min = 1, max = 64, message = "Request key must be between 1 and 64 characters")
        String requestKey,

        @Size(max = 500, message = "Reason cannot exceed 500 characters")
        String reason,

        String patientId
) {
    public boolean hasPatientId() {
        return patientId != null && !patientId.isBlank();
    }
}
