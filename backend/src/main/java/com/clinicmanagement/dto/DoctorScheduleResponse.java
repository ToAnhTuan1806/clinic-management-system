package com.clinicmanagement.dto;

import com.clinicmanagement.entity.DoctorSchedule;
import com.clinicmanagement.entity.ScheduleStatus;
import java.time.Instant;
import java.time.LocalDate;

public record DoctorScheduleResponse(
        String id,
        String doctorId,
        String doctorCode,
        String doctorName,
        String specialtyName,
        LocalDate workDate,
        Instant startAt,
        Instant endAt,
        int slotMinutes,
        ScheduleStatus status,
        Instant createdAt,
        Instant updatedAt
) {
    public static DoctorScheduleResponse from(DoctorSchedule schedule) {
        var doctor = schedule.getDoctor();
        return new DoctorScheduleResponse(
                schedule.getId() != null ? schedule.getId().toString() : null,
                doctor != null && doctor.getId() != null ? doctor.getId().toString() : null,
                doctor != null ? doctor.getDoctorCode() : null,
                doctor != null && doctor.getUser() != null ? doctor.getUser().getFullName() : null,
                doctor != null && doctor.getSpecialty() != null ? doctor.getSpecialty().getName() : null,
                schedule.getWorkDate(),
                schedule.getStartAt(),
                schedule.getEndAt(),
                schedule.getSlotMinutes(),
                schedule.getStatus(),
                schedule.getCreatedAt(),
                schedule.getUpdatedAt()
        );
    }
}
