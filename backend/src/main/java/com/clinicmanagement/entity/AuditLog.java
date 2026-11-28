package com.clinicmanagement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

@Entity
@Table(name = "audit_logs")
public class AuditLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "actor_user_id")
    private Long actorUserId;

    @Column(name = "actor_role", nullable = false, length = 32)
    private String actorRole;

    @Column(name = "action", nullable = false, length = 64)
    private String action;

    @Column(name = "entity_type", nullable = false, length = 64)
    private String entityType;

    @Column(name = "entity_id")
    private Long entityId;

    @Enumerated(EnumType.STRING)
    @Column(name = "result", nullable = false, length = 16)
    private AuditResult result;

    @Column(name = "event_key", length = 128, unique = true)
    private String eventKey;

    @Column(name = "correlation_id", length = 64)
    private String correlationId;

    @Column(name = "metadata", length = 500)
    private String metadata;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    protected AuditLog() {
    }

    public AuditLog(
            Long actorUserId,
            String actorRole,
            String action,
            String entityType,
            Long entityId,
            AuditResult result,
            String eventKey,
            String correlationId,
            String metadata,
            Instant occurredAt) {
        this.actorUserId = actorUserId;
        this.actorRole = actorRole;
        this.action = action;
        this.entityType = entityType;
        this.entityId = entityId;
        this.result = result;
        this.eventKey = eventKey;
        this.correlationId = correlationId;
        this.metadata = metadata;
        this.occurredAt = occurredAt.truncatedTo(ChronoUnit.MICROS);
    }

    public Long getId() {
        return id;
    }

    public Long getActorUserId() {
        return actorUserId;
    }

    public String getActorRole() {
        return actorRole;
    }

    public String getAction() {
        return action;
    }

    public String getEntityType() {
        return entityType;
    }

    public Long getEntityId() {
        return entityId;
    }

    public AuditResult getResult() {
        return result;
    }

    public String getEventKey() {
        return eventKey;
    }

    public String getCorrelationId() {
        return correlationId;
    }

    public String getMetadata() {
        return metadata;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }
}
