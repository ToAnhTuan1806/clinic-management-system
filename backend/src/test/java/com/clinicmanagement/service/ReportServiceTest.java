package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.clinicmanagement.dto.VisitReportResponse;
import com.clinicmanagement.entity.AppointmentStatus;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.DashboardRepository;
import com.clinicmanagement.repository.ReportRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class ReportServiceTest {
    private final DashboardRepository dashboard = mock(DashboardRepository.class);
    private final ReportRepository reports = mock(ReportRepository.class);
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-28T03:00:00Z"), ZoneOffset.UTC);
    private final ReportService service = new ReportService(dashboard, reports, clock);

    @Test
    void invalidDateRangeThrows400() {
        AuthenticatedUser admin = new AuthenticatedUser(1L, "admin@clinic.test", "Admin", Role.ADMIN, UserStatus.ACTIVE);
        ManagementException inverted = assertThrows(ManagementException.class,
                () -> service.visitReport(admin, LocalDate.of(2026, 11, 29), LocalDate.of(2026, 11, 28)));
        assertThat(inverted.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(inverted.getCode()).isEqualTo("VALIDATION_FAILED");

        ManagementException tooLong = assertThrows(ManagementException.class,
                () -> service.visitReport(admin, LocalDate.of(2025, 1, 1), LocalDate.of(2026, 1, 2)));
        assertThat(tooLong.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void doctorScopePassesDoctorUserIdAndAggregatesAllDimensions() {
        AuthenticatedUser doctor = new AuthenticatedUser(42L, "doc@clinic.test", "Dr. A", Role.DOCTOR, UserStatus.ACTIVE);
        DashboardRepository.StatusCount completedRow = mock(DashboardRepository.StatusCount.class);
        when(completedRow.getStatus()).thenReturn(AppointmentStatus.COMPLETED);
        when(completedRow.getTotal()).thenReturn(3L);
        when(completedRow.getCheckedIn()).thenReturn(3L);

        ReportRepository.DailyVisitRow dayRow = mock(ReportRepository.DailyVisitRow.class);
        when(dayRow.getVisitDate()).thenReturn(LocalDate.of(2026, 11, 28));
        when(dayRow.getTotalAppointments()).thenReturn(3L);
        when(dayRow.getCheckedInCount()).thenReturn(3L);
        when(dayRow.getCompletedCount()).thenReturn(3L);
        when(dayRow.getCancelledCount()).thenReturn(0L);
        when(dayRow.getNoShowCount()).thenReturn(0L);

        ReportRepository.DoctorVisitRow docRow = mock(ReportRepository.DoctorVisitRow.class);
        when(docRow.getDoctorId()).thenReturn(10L);
        when(docRow.getDoctorCode()).thenReturn("DOC-10");
        when(docRow.getDoctorName()).thenReturn("Dr. A");
        when(docRow.getSpecialtyName()).thenReturn("Cardiology");
        when(docRow.getTotalAppointments()).thenReturn(3L);
        when(docRow.getCheckedInCount()).thenReturn(3L);
        when(docRow.getCompletedCount()).thenReturn(3L);

        ReportRepository.SpecialtyVisitRow specRow = mock(ReportRepository.SpecialtyVisitRow.class);
        when(specRow.getSpecialtyId()).thenReturn(5L);
        when(specRow.getSpecialtyCode()).thenReturn("CARD");
        when(specRow.getSpecialtyName()).thenReturn("Cardiology");
        when(specRow.getTotalAppointments()).thenReturn(3L);
        when(specRow.getCheckedInCount()).thenReturn(3L);
        when(specRow.getCompletedCount()).thenReturn(3L);

        when(dashboard.counts(any(), any(), eq(42L))).thenReturn(List.of(completedRow));
        when(dashboard.uniquePatients(any(), any(), eq(42L))).thenReturn(2L);
        when(reports.dailyVisits(any(), any(), eq(42L))).thenReturn(List.of(dayRow));
        when(reports.visitsByDoctor(any(), any(), eq(42L))).thenReturn(List.of(docRow));
        when(reports.visitsBySpecialty(any(), any(), eq(42L))).thenReturn(List.of(specRow));

        VisitReportResponse response = service.visitReport(doctor, null, null);
        assertThat(response.from()).isEqualTo(LocalDate.of(2026, 11, 28));
        assertThat(response.to()).isEqualTo(LocalDate.of(2026, 11, 28));
        assertThat(response.timezone()).isEqualTo("Asia/Ho_Chi_Minh");
        assertThat(response.totalAppointments()).isEqualTo(3L);
        assertThat(response.checkedInCount()).isEqualTo(3L);
        assertThat(response.completedCount()).isEqualTo(3L);
        assertThat(response.uniquePatients()).isEqualTo(2L);
        assertThat(response.appointmentsByStatus()).hasSize(AppointmentStatus.values().length);
        assertThat(response.dailyVisits()).hasSize(1);
        assertThat(response.byDoctor()).singleElement().satisfies(d -> assertThat(d.doctorId()).isEqualTo("10"));
        assertThat(response.bySpecialty()).singleElement().satisfies(s -> assertThat(s.specialtyId()).isEqualTo("5"));
    }

    @Test
    void adminScopePassesNullDoctorUserId() {
        AuthenticatedUser admin = new AuthenticatedUser(1L, "admin@clinic.test", "Admin", Role.ADMIN, UserStatus.ACTIVE);
        when(dashboard.counts(any(), any(), isNull())).thenReturn(List.of());
        when(dashboard.uniquePatients(any(), any(), isNull())).thenReturn(0L);
        when(reports.dailyVisits(any(), any(), isNull())).thenReturn(List.of());
        when(reports.visitsByDoctor(any(), any(), isNull())).thenReturn(List.of());
        when(reports.visitsBySpecialty(any(), any(), isNull())).thenReturn(List.of());

        VisitReportResponse response = service.visitReport(admin, LocalDate.of(2026, 11, 22), LocalDate.of(2026, 11, 28));
        assertThat(response.totalAppointments()).isZero();
        verify(reports).dailyVisits(
                Instant.parse("2026-11-21T17:00:00Z"),
                Instant.parse("2026-11-28T17:00:00Z"),
                null);
    }
}
