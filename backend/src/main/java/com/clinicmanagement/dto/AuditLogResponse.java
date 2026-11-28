package com.clinicmanagement.dto;

import com.clinicmanagement.entity.AuditLog;
import com.clinicmanagement.entity.AuditResult;
import java.time.Instant;

public record AuditLogResponse(
        String id,
        String actorUserId,
        String actorRole,
        String action,
        String entityType,
        String entityId,
        AuditResult result,
        String correlationId,
        String metadata,
        Instant occurredAt) {

    public static AuditLogResponse from(AuditLog log) {
        return new AuditLogResponse(
                log.getId() != null ? log.getId().toString() : null,
                log.getActorUserId() != null ? log.getActorUserId().toString() : null,
                log.getActorRole(),
                log.getAction(),
                log.getEntityType(),
                log.getEntityId() != null ? log.getEntityId().toString() : null,
                log.getResult(),
                log.getCorrelationId(),
                log.getMetadata(),
                log.getOccurredAt());
    }
}
