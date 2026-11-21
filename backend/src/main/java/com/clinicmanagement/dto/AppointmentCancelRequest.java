package com.clinicmanagement.dto;

public record AppointmentCancelRequest(
        String reason,
        Long expectedVersion
) {
}
