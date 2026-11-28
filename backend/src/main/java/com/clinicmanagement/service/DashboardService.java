package com.clinicmanagement.service;

import com.clinicmanagement.dto.DashboardSummaryResponse;
import com.clinicmanagement.entity.AppointmentStatus;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.DashboardRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.EnumMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DashboardService {
    private final DashboardRepository dashboard;
    private final Clock clock;
    public DashboardService(DashboardRepository dashboard, Clock clock) {
        this.dashboard = dashboard;
        this.clock = clock;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','DOCTOR')")
    public DashboardSummaryResponse summary(AuthenticatedUser viewer, LocalDate from, LocalDate to) {
        ZoneId zone = AppointmentService.ZONE_VN;
        LocalDate today = LocalDate.now(clock.withZone(zone));
        from = from == null ? today : from;
        to = to == null ? today : to;
        if (from.isAfter(to) || ChronoUnit.DAYS.between(from, to) >= 366
                || from.isBefore(LocalDate.of(1000, 1, 2)) || to.getYear() > 9999) {
            throw new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Invalid date range.");
        }
        Instant start = from.atStartOfDay(zone).toInstant();
        Instant end = to.plusDays(1).atStartOfDay(zone).toInstant();
        Long doctorUserId = viewer.role() == Role.DOCTOR ? viewer.id() : null;
        Map<AppointmentStatus, Long> distribution = new EnumMap<>(AppointmentStatus.class);
        for (var status : AppointmentStatus.values()) distribution.put(status, 0L);
        long total = 0;
        long checkedIn = 0;
        for (var row : dashboard.counts(start, end, doctorUserId)) {
            distribution.put(row.getStatus(), row.getTotal());
            total += row.getTotal();
            checkedIn += row.getCheckedIn();
        }
        return new DashboardSummaryResponse(from, to, zone.getId(), total, distribution, checkedIn,
                distribution.get(AppointmentStatus.COMPLETED), dashboard.uniquePatients(start, end, doctorUserId));
    }
}
