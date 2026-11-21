package com.clinicmanagement.dto;

import com.clinicmanagement.entity.ScheduleStatus;
import java.time.Instant;

public record DoctorSchedulePatchRequest(
        Instant startAt,
        Instant endAt,
        Integer slotMinutes,
        ScheduleStatus status
) {
    public boolean isEmpty() {
        return startAt == null && endAt == null && slotMinutes == null && status == null;
    }
}
