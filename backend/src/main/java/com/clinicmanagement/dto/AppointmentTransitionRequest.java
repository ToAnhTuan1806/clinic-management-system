package com.clinicmanagement.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record AppointmentTransitionRequest(
        @NotNull(message = "Expected version is required.")
        @Min(value = 0, message = "Expected version must be a non-negative integer.")
        Long expectedVersion
) {
}
