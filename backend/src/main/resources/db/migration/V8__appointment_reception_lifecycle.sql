-- CL-D09-DB: appointment reception lifecycle metadata for confirmation, check-in, and no-show (FR-08).
-- Review before applying to any shared Clinic database.
-- Adds confirmation metadata: confirmed_at (UTC), confirmed_by (FK users).
-- Adds check-in metadata: checked_in_at (UTC), checked_in_by (FK users).
-- Adds no-show metadata: no_show_at (UTC), no_show_by (FK users).
-- Preserves V6 active slot uniqueness and generated column logic.
-- All foreign keys use ON DELETE RESTRICT ON UPDATE RESTRICT.

ALTER TABLE appointments
    ADD COLUMN confirmed_at DATETIME(6) NULL AFTER previous_start_at_utc,
    ADD COLUMN confirmed_by BIGINT NULL AFTER confirmed_at,
    ADD COLUMN checked_in_at DATETIME(6) NULL AFTER confirmed_by,
    ADD COLUMN checked_in_by BIGINT NULL AFTER checked_in_at,
    ADD COLUMN no_show_at DATETIME(6) NULL AFTER checked_in_by,
    ADD COLUMN no_show_by BIGINT NULL AFTER no_show_at,
    ADD CONSTRAINT fk_appointments_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT fk_appointments_checked_in_by FOREIGN KEY (checked_in_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT fk_appointments_no_show_by FOREIGN KEY (no_show_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT chk_appointments_confirmed_at CHECK (
        confirmed_at IS NULL OR confirmed_at >= created_at
    ),
    ADD CONSTRAINT chk_appointments_checked_in_at CHECK (
        checked_in_at IS NULL OR checked_in_at >= created_at
    ),
    ADD CONSTRAINT chk_appointments_no_show_at CHECK (
        no_show_at IS NULL OR no_show_at >= created_at
    ),
    ADD INDEX ix_appointments_confirmed_at (confirmed_at),
    ADD INDEX ix_appointments_checked_in_at (checked_in_at),
    ADD INDEX ix_appointments_no_show_at (no_show_at);
