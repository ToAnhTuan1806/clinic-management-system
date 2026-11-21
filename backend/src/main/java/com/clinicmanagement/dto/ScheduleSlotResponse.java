package com.clinicmanagement.dto;

import java.time.Instant;
import java.time.LocalDate;

public record ScheduleSlotResponse(
        String scheduleId,
        String doctorId,
        LocalDate date,
        Instant startAt,
        Instant endAt,
        boolean isAvailable
) { }
