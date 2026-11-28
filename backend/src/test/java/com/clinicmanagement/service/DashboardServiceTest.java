package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.repository.DashboardRepository;
import com.clinicmanagement.security.AuthenticatedUser;
import java.time.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class DashboardServiceTest {
    @Test
    void defaultDayUsesVietnamEvenWhenUtcDateIsDifferent() {
        var repository = mock(DashboardRepository.class);
        var clock = Clock.fixed(Instant.parse("2026-11-21T18:00:00Z"), ZoneOffset.UTC);
        var start = Instant.parse("2026-11-21T17:00:00Z");
        var end = Instant.parse("2026-11-22T17:00:00Z");
        when(repository.counts(start, end, null)).thenReturn(List.of());
        var service = new DashboardService(repository, clock);
        var viewer = new AuthenticatedUser(1L, "admin@example.invalid", "Synthetic Admin", Role.ADMIN, UserStatus.ACTIVE);
        var response = service.summary(viewer, null, null);
        assertThat(response.from()).isEqualTo(LocalDate.of(2026, 11, 22));
        assertThat(response.to()).isEqualTo(response.from());
        assertThat(response.totalAppointments()).isZero();
        verify(repository).counts(start, end, null);
        verify(repository).uniquePatients(start, end, null);
    }
}
