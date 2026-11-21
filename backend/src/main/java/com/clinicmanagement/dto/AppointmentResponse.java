package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Appointment;
import java.time.Instant;

public record AppointmentResponse(
        String id,
        String appointmentCode,
        String patientId,
        String patientCode,
        String patientFullName,
        String patientPhone,
        String doctorId,
        String doctorCode,
        String doctorFullName,
        String specialtyName,
        String scheduleId,
        Instant startAt,
        Instant endAt,
        String status,
        String reason,
        String createdBy,
        Instant createdAt,
        Instant updatedAt
) {
    public static AppointmentResponse from(Appointment a) {
        return new AppointmentResponse(
                a.getId().toString(),
                a.getAppointmentCode(),
                a.getPatient().getId().toString(),
                a.getPatient().getPatientCode(),
                a.getPatient().getFullName(),
                a.getPatient().getPhone(),
                a.getDoctor().getId().toString(),
                a.getDoctor().getDoctorCode(),
                a.getDoctor().getUser().getFullName(),
                a.getDoctor().getSpecialty() != null ? a.getDoctor().getSpecialty().getName() : null,
                a.getSchedule().getId().toString(),
                a.getStartAt(),
                a.getEndAt(),
                a.getStatus().name(),
                a.getReason(),
                a.getCreatedBy().getId().toString(),
                a.getCreatedAt(),
                a.getUpdatedAt()
        );
    }
}
