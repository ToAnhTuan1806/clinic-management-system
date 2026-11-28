package com.clinicmanagement.service;

import com.clinicmanagement.dto.VisitReportResponse;
import com.clinicmanagement.entity.AppointmentStatus;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.DashboardRepository;
import com.clinicmanagement.repository.ReportRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ReportService {
    private final DashboardRepository dashboard;
    private final ReportRepository reports;
    private final Clock clock;

    public ReportService(DashboardRepository dashboard, ReportRepository reports, Clock clock) {
        this.dashboard = dashboard;
        this.reports = reports;
        this.clock = clock;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','DOCTOR')")
    public VisitReportResponse visitReport(AuthenticatedUser viewer, LocalDate from, LocalDate to) {
        ZoneId zone = AppointmentService.ZONE_VN;
        LocalDate today = LocalDate.now(clock.withZone(zone));
        LocalDate effectiveFrom = from == null ? today : from;
        LocalDate effectiveTo = to == null ? today : to;

        if (effectiveFrom.isAfter(effectiveTo)
                || ChronoUnit.DAYS.between(effectiveFrom, effectiveTo) >= 366
                || effectiveFrom.isBefore(LocalDate.of(1000, 1, 2))
                || effectiveTo.getYear() > 9999) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Invalid date range.");
        }

        Instant start = effectiveFrom.atStartOfDay(zone).toInstant();
        Instant end = effectiveTo.plusDays(1).atStartOfDay(zone).toInstant();
        Long doctorUserId = viewer.role() == Role.DOCTOR ? viewer.id() : null;

        Map<AppointmentStatus, Long> distribution = new EnumMap<>(AppointmentStatus.class);
        for (AppointmentStatus status : AppointmentStatus.values()) {
            distribution.put(status, 0L);
        }
        long total = 0;
        long checkedIn = 0;
        for (var row : dashboard.counts(start, end, doctorUserId)) {
            distribution.put(row.getStatus(), row.getTotal());
            total += row.getTotal();
            checkedIn += row.getCheckedIn();
        }
        long uniquePatients = dashboard.uniquePatients(start, end, doctorUserId);

        List<VisitReportResponse.DailyVisitStat> dailyVisits = reports.dailyVisits(start, end, doctorUserId).stream()
                .map(row -> new VisitReportResponse.DailyVisitStat(
                        row.getVisitDate(),
                        row.getTotalAppointments(),
                        row.getCheckedInCount(),
                        row.getCompletedCount(),
                        row.getCancelledCount(),
                        row.getNoShowCount()))
                .toList();

        List<VisitReportResponse.DoctorVisitStat> byDoctor = reports.visitsByDoctor(start, end, doctorUserId).stream()
                .map(row -> new VisitReportResponse.DoctorVisitStat(
                        row.getDoctorId().toString(),
                        row.getDoctorCode(),
                        row.getDoctorName(),
                        row.getSpecialtyName(),
                        row.getTotalAppointments(),
                        row.getCheckedInCount(),
                        row.getCompletedCount()))
                .toList();

        List<VisitReportResponse.SpecialtyVisitStat> bySpecialty = reports.visitsBySpecialty(start, end, doctorUserId).stream()
                .map(row -> new VisitReportResponse.SpecialtyVisitStat(
                        row.getSpecialtyId().toString(),
                        row.getSpecialtyCode(),
                        row.getSpecialtyName(),
                        row.getTotalAppointments(),
                        row.getCheckedInCount(),
                        row.getCompletedCount()))
                .toList();

        return new VisitReportResponse(
                effectiveFrom,
                effectiveTo,
                zone.getId(),
                total,
                distribution,
                checkedIn,
                distribution.get(AppointmentStatus.COMPLETED),
                uniquePatients,
                dailyVisits,
                byDoctor,
                bySpecialty);
    }
}
