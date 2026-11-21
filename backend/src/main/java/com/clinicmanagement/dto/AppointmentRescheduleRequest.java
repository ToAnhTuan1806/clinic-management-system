package com.clinicmanagement.dto;

import java.time.Instant;

public record AppointmentRescheduleRequest(
        String scheduleId,
        Instant startAt,
        Long expectedVersion
) {
}
