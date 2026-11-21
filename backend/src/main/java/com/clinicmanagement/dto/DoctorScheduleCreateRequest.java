package com.clinicmanagement.dto;

import com.clinicmanagement.entity.ScheduleStatus;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.Instant;

public record DoctorScheduleCreateRequest(
        @NotNull @Positive Long doctorId,
        @NotNull Instant startAt,
        @NotNull Instant endAt,
        Integer slotMinutes,
        ScheduleStatus status
) {
    public DoctorScheduleCreateRequest {
        if (slotMinutes == null) {
            slotMinutes = 30;
        }
        if (status == null) {
            status = ScheduleStatus.ACTIVE;
        }
    }
}
