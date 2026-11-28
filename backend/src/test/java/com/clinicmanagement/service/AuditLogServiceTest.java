package com.clinicmanagement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.clinicmanagement.entity.AuditLog;
import com.clinicmanagement.entity.AuditResult;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.AuditLogRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

class AuditLogServiceTest {
    private final AuditLogRepository repository = mock(AuditLogRepository.class);
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-28T05:00:00Z"), ZoneOffset.UTC);
    private final AuditLogService service = new AuditLogService(repository, clock);

    @Test
    void recordSuccessPersistsTruncatedUtcTimestampAndAllowlistedFields() {
        when(repository.saveAndFlush(any(AuditLog.class))).thenAnswer(i -> i.getArgument(0));

        service.recordSuccess(10L, Role.RECEPTIONIST, AuditLogService.ACTION_APPOINTMENT_CHECKED_IN,
                AuditLogService.ENTITY_APPOINTMENT, 100L, "appointment:100:v2:CHECKED_IN",
                "{\"appointmentCode\":\"APP000100\"}");

        ArgumentCaptor<AuditLog> captor = ArgumentCaptor.forClass(AuditLog.class);
        verify(repository).saveAndFlush(captor.capture());
        AuditLog saved = captor.getValue();
        assertThat(saved.getActorUserId()).isEqualTo(10L);
        assertThat(saved.getActorRole()).isEqualTo("RECEPTIONIST");
        assertThat(saved.getAction()).isEqualTo("APPOINTMENT_CHECKED_IN");
        assertThat(saved.getEntityType()).isEqualTo("APPOINTMENT");
        assertThat(saved.getEntityId()).isEqualTo(100L);
        assertThat(saved.getResult()).isEqualTo(AuditResult.SUCCESS);
        assertThat(saved.getEventKey()).isEqualTo("appointment:100:v2:CHECKED_IN");
        assertThat(saved.getOccurredAt()).isEqualTo(Instant.parse("2026-11-28T05:00:00Z"));
    }

    @Test
    void recordSuccessMapsDataIntegrityViolationTo409Conflict() {
        when(repository.saveAndFlush(any(AuditLog.class))).thenThrow(new DataIntegrityViolationException("dup"));

        ManagementException ex = assertThrows(ManagementException.class, () ->
                service.recordSuccess(10L, Role.ADMIN, AuditLogService.ACTION_APPOINTMENT_BOOKED,
                        AuditLogService.ENTITY_APPOINTMENT, 100L, "dup-key", null));
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getCode()).isEqualTo("AUDIT_LOG_CONFLICT");
    }

    @Test
    void listValidatesPaginationSortActorAndDateRange() {
        assertThat(assertThrows(ManagementException.class,
                () -> service.list(null, null, null, null, -1, 20, null)).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(assertThrows(ManagementException.class,
                () -> service.list(null, null, null, null, 0, 101, null)).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(assertThrows(ManagementException.class,
                () -> service.list(null, null, 0L, null, 0, 20, null)).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(assertThrows(ManagementException.class,
                () -> service.list(null, null, null, null, 0, 20, "action,asc")).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(assertThrows(ManagementException.class,
                () -> service.list(LocalDate.of(2026, 11, 29), LocalDate.of(2026, 11, 28), null, null, 0, 20, null))
                .getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @SuppressWarnings("unchecked")
    void listReturnsPagedAuditLogs() {
        AuditLog log = new AuditLog(10L, "ADMIN", AuditLogService.ACTION_USER_REGISTERED,
                AuditLogService.ENTITY_USER, 10L, AuditResult.SUCCESS, "user:10:REGISTERED",
                null, null, clock.instant());
        ReflectionTestUtils.setField(log, "id", 1L);
        when(repository.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(log)));

        var page = service.list(LocalDate.of(2026, 11, 28), LocalDate.of(2026, 11, 28),
                10L, "USER_REGISTERED", 0, 20, "occurredAt,asc");
        assertThat(page.totalElements()).isEqualTo(1L);
        assertThat(page.items()).singleElement().satisfies(item -> {
            assertThat(item.id()).isEqualTo("1");
            assertThat(item.actorUserId()).isEqualTo("10");
            assertThat(item.action()).isEqualTo("USER_REGISTERED");
            assertThat(item.result()).isEqualTo(AuditResult.SUCCESS);
        });
    }
}
