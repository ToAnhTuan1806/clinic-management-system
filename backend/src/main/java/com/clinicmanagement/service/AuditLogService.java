package com.clinicmanagement.service;

import com.clinicmanagement.dto.AuditLogResponse;
import com.clinicmanagement.dto.PageResponse;
import com.clinicmanagement.entity.AuditLog;
import com.clinicmanagement.entity.AuditResult;
import com.clinicmanagement.entity.Role;
import com.clinicmanagement.exception.ManagementException;
import com.clinicmanagement.repository.AuditLogRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditLogService {
    public static final String ACTION_APPOINTMENT_BOOKED = "APPOINTMENT_BOOKED";
    public static final String ACTION_APPOINTMENT_RESCHEDULED = "APPOINTMENT_RESCHEDULED";
    public static final String ACTION_APPOINTMENT_CANCELLED = "APPOINTMENT_CANCELLED";
    public static final String ACTION_APPOINTMENT_CONFIRMED = "APPOINTMENT_CONFIRMED";
    public static final String ACTION_APPOINTMENT_CHECKED_IN = "APPOINTMENT_CHECKED_IN";
    public static final String ACTION_APPOINTMENT_NO_SHOW = "APPOINTMENT_NO_SHOW";
    public static final String ACTION_MEDICAL_RECORD_COMPLETED = "MEDICAL_RECORD_COMPLETED";
    public static final String ACTION_MEDICAL_RECORD_RELEASED = "MEDICAL_RECORD_RELEASED";
    public static final String ACTION_USER_REGISTERED = "USER_REGISTERED";
    public static final String ACTION_PROFILE_UPDATED = "PROFILE_UPDATED";

    public static final String ENTITY_APPOINTMENT = "APPOINTMENT";
    public static final String ENTITY_MEDICAL_RECORD = "MEDICAL_RECORD";
    public static final String ENTITY_USER = "USER";

    private final AuditLogRepository auditLogs;
    private final Clock clock;

    public AuditLogService(AuditLogRepository auditLogs, Clock clock) {
        this.auditLogs = auditLogs;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordSuccess(
            Long actorUserId,
            Role actorRole,
            String action,
            String entityType,
            Long entityId,
            String eventKey,
            String metadata) {
        String roleName = actorRole != null ? actorRole.name() : "SYSTEM";
        AuditLog log = new AuditLog(
                actorUserId,
                roleName,
                action,
                entityType,
                entityId,
                AuditResult.SUCCESS,
                eventKey,
                null,
                metadata,
                clock.instant());
        try {
            auditLogs.saveAndFlush(log);
        } catch (DataIntegrityViolationException exception) {
            throw ManagementException.conflict("AUDIT_LOG_CONFLICT", "Audit log could not be saved.");
        }
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    @PreAuthorize("hasRole('ADMIN')")
    public PageResponse<AuditLogResponse> list(
            LocalDate from,
            LocalDate to,
            Long actorUserId,
            String action,
            int page,
            int size,
            String sortParam) {
        if (page < 0 || size < 1 || size > 100) {
            throw validation("Invalid pagination parameters.");
        }
        if (actorUserId != null && actorUserId <= 0) {
            throw validation("Actor user ID must be a positive integer.");
        }

        ZoneId zone = AppointmentService.ZONE_VN;
        Instant start = null;
        Instant end = null;
        if (from != null || to != null) {
            if (from != null && (from.isBefore(LocalDate.of(1000, 1, 2)) || from.getYear() > 9999)) {
                throw validation("Invalid date range.");
            }
            if (to != null && (to.isBefore(LocalDate.of(1000, 1, 2)) || to.getYear() > 9999)) {
                throw validation("Invalid date range.");
            }
            if (from != null && to != null && (from.isAfter(to) || ChronoUnit.DAYS.between(from, to) >= 366)) {
                throw validation("Invalid date range.");
            }
            if (from != null) {
                start = from.atStartOfDay(zone).toInstant();
            }
            if (to != null) {
                end = to.plusDays(1).atStartOfDay(zone).toInstant();
            }
        }

        String normalizedAction = null;
        if (action != null && !action.isBlank()) {
            normalizedAction = action.trim();
            if (normalizedAction.length() > 64) {
                throw validation("Action filter exceeds maximum length.");
            }
        }

        Sort sort = parseSort(sortParam);
        Specification<AuditLog> spec = (root, query, cb) -> cb.conjunction();
        if (start != null) {
            Instant finalStart = start;
            spec = spec.and((root, query, cb) -> cb.greaterThanOrEqualTo(root.get("occurredAt"), finalStart));
        }
        if (end != null) {
            Instant finalEnd = end;
            spec = spec.and((root, query, cb) -> cb.lessThan(root.get("occurredAt"), finalEnd));
        }
        if (actorUserId != null) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("actorUserId"), actorUserId));
        }
        if (normalizedAction != null) {
            String finalAction = normalizedAction;
            spec = spec.and((root, query, cb) -> cb.equal(root.get("action"), finalAction));
        }

        var result = auditLogs.findAll(spec, PageRequest.of(page, size, sort));
        return PageResponse.from(result.map(AuditLogResponse::from));
    }

    private static Sort parseSort(String sortParam) {
        if (sortParam == null || sortParam.isBlank()) {
            return Sort.by(Sort.Order.desc("occurredAt"), Sort.Order.desc("id"));
        }
        String normalized = sortParam.trim().toLowerCase(Locale.ROOT);
        if ("occurredat,desc".equals(normalized) || "occurredat".equals(normalized)) {
            return Sort.by(Sort.Order.desc("occurredAt"), Sort.Order.desc("id"));
        }
        if ("occurredat,asc".equals(normalized)) {
            return Sort.by(Sort.Order.asc("occurredAt"), Sort.Order.asc("id"));
        }
        throw validation("Unsupported sort parameter. Allowed values: occurredAt,desc or occurredAt,asc.");
    }

    private static ManagementException validation(String message) {
        return new ManagementException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }
}
