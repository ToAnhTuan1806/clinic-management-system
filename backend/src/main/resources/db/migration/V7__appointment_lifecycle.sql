-- CL-D08-DB: appointment lifecycle metadata for cancellation and rescheduling (FR-07).
-- Review before applying to any shared Clinic database.
-- Adds cancellation metadata: cancelled_at (UTC), cancelled_by (FK users), cancellation_reason.
-- Adds minimal rescheduling metadata: rescheduled_at (UTC), rescheduled_by (FK users), previous_schedule_id (FK doctor_schedules), previous_start_at_utc (UTC).
-- Preserves V6 active slot uniqueness and generated column logic.
-- All foreign keys use ON DELETE RESTRICT ON UPDATE RESTRICT.

ALTER TABLE appointments
    ADD COLUMN cancelled_at DATETIME(6) NULL AFTER reason,
    ADD COLUMN cancelled_by BIGINT NULL AFTER cancelled_at,
    ADD COLUMN cancellation_reason VARCHAR(255) NULL AFTER cancelled_by,
    ADD COLUMN rescheduled_at DATETIME(6) NULL AFTER cancellation_reason,
    ADD COLUMN rescheduled_by BIGINT NULL AFTER rescheduled_at,
    ADD COLUMN previous_schedule_id BIGINT NULL AFTER rescheduled_by,
    ADD COLUMN previous_start_at_utc DATETIME(6) NULL AFTER previous_schedule_id,
    ADD CONSTRAINT fk_appointments_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT fk_appointments_rescheduled_by FOREIGN KEY (rescheduled_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT fk_appointments_previous_schedule FOREIGN KEY (previous_schedule_id) REFERENCES doctor_schedules (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT chk_appointments_cancellation_reason CHECK (
        cancellation_reason IS NULL OR CHAR_LENGTH(cancellation_reason) <= 255
    ),
    ADD CONSTRAINT chk_appointments_cancelled_at CHECK (
        cancelled_at IS NULL OR cancelled_at >= created_at
    ),
    ADD CONSTRAINT chk_appointments_rescheduled_at CHECK (
        rescheduled_at IS NULL OR rescheduled_at >= created_at
    ),
    ADD INDEX ix_appointments_cancelled_at (cancelled_at),
    ADD INDEX ix_appointments_rescheduled_at (rescheduled_at);
