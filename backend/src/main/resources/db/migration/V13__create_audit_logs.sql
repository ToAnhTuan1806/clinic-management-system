-- D14 / FR-14. Append-only audit logs with UTC timestamps; no clinical or secret payloads.
-- Emit SUCCESS audit records within the SAME business transaction as the state change.
-- Idempotent replays must not insert duplicate audit records (protected by unique event_key when provided).
-- Reports (/api/v1/reports/visits) are aggregated directly from appointments/doctors/specialties, matching D13 dashboard timezone (Asia/Ho_Chi_Minh).
CREATE TABLE audit_logs (
    id BIGINT NOT NULL AUTO_INCREMENT,
    actor_user_id BIGINT NULL,
    actor_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    action VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entity_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entity_id BIGINT NULL,
    result VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    correlation_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    metadata VARCHAR(500) NULL,
    occurred_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_audit_logs PRIMARY KEY (id),
    CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT uk_audit_logs_event_key UNIQUE (event_key),
    CONSTRAINT chk_audit_logs_actor_role CHECK (actor_role IN (
        'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT', 'SYSTEM'
    )),
    CONSTRAINT chk_audit_logs_result CHECK (result IN ('SUCCESS', 'DENIED', 'FAILED')),
    CONSTRAINT chk_audit_logs_action CHECK (
        CHAR_LENGTH(TRIM(action)) > 0
        AND CAST(action AS BINARY) = CAST(TRIM(action) AS BINARY)
    ),
    CONSTRAINT chk_audit_logs_entity_type CHECK (
        CHAR_LENGTH(TRIM(entity_type)) > 0
        AND CAST(entity_type AS BINARY) = CAST(TRIM(entity_type) AS BINARY)
    ),
    INDEX ix_audit_logs_occurred_id (occurred_at, id),
    INDEX ix_audit_logs_actor_occurred_id (actor_user_id, occurred_at, id),
    INDEX ix_audit_logs_action_occurred_id (action, occurred_at, id),
    INDEX ix_audit_logs_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
