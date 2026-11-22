-- D13 / FR-13. UTC timestamps; in-app operational messages only, never clinical data.
-- Key policy confirmed 2026-11-22: appointment:{id}:version:{postChangeVersion}:event:{eventType}.
-- Emit after flushing the appointment version, within the SAME transaction.
-- Booking retries reuse the original event (creation version 0), not a later appointment version.
-- Backend must use allowlisted message templates, never copy reason/medical/prescription content.
-- No historical backfill. Dashboard is derived from appointments, not a new table.
CREATE TABLE notifications (
    id BIGINT NOT NULL AUTO_INCREMENT,
    recipient_user_id BIGINT NOT NULL,
    appointment_id BIGINT NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL,
    body VARCHAR(500) NULL,
    created_at DATETIME(6) NOT NULL,
    read_at DATETIME(6) NULL,
    CONSTRAINT pk_notifications PRIMARY KEY (id),
    CONSTRAINT uk_notifications_recipient_event UNIQUE (recipient_user_id, event_key),
    CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_notifications_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_notifications_event_type CHECK (event_type IN (
        'APPOINTMENT_CREATED', 'APPOINTMENT_RESCHEDULED',
        'APPOINTMENT_CANCELLED', 'APPOINTMENT_CONFIRMED'
    )),
    CONSTRAINT chk_notifications_event_key CHECK (
        CHAR_LENGTH(TRIM(event_key)) > 0
        AND CAST(event_key AS BINARY) = CAST(TRIM(event_key) AS BINARY)
    ),
    CONSTRAINT chk_notifications_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
    CONSTRAINT chk_notifications_read_at CHECK (read_at IS NULL OR read_at >= created_at),
    INDEX ix_notifications_recipient_created_id (recipient_user_id, created_at, id),
    -- FK support, not an additional unread/query index.
    INDEX ix_notifications_appointment (appointment_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
