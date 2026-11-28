package com.clinicmanagement.dto;

import com.clinicmanagement.entity.AppointmentStatus;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

public record VisitReportResponse(
        LocalDate from,
        LocalDate to,
        String timezone,
        long totalAppointments,
        Map<AppointmentStatus, Long> appointmentsByStatus,
        long checkedInCount,
        long completedCount,
        long uniquePatients,
        List<DailyVisitStat> dailyVisits,
        List<DoctorVisitStat> byDoctor,
        List<SpecialtyVisitStat> bySpecialty) {

    public record DailyVisitStat(
            LocalDate date,
            long totalAppointments,
            long checkedInCount,
            long completedCount,
            long cancelledCount,
            long noShowCount) {
    }

    public record DoctorVisitStat(
            String doctorId,
            String doctorCode,
            String doctorName,
            String specialtyName,
            long totalAppointments,
            long checkedInCount,
            long completedCount) {
    }

    public record SpecialtyVisitStat(
            String specialtyId,
            String specialtyCode,
            String specialtyName,
            long totalAppointments,
            long checkedInCount,
            long completedCount) {
    }
}
