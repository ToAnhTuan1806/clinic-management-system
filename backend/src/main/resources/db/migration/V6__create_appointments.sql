-- CL-D07-DB: appointments table and concurrency protection (FR-07).
-- Review before applying to any shared Clinic database.
-- All timestamps are stored in UTC with microsecond precision DATETIME(6).
-- Initial status is PENDING; supported statuses: PENDING, CONFIRMED, CHECKED_IN, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW.
-- Active slot uniqueness enforced via (doctor_id, active_slot_start_utc).
-- Cancelled appointments release active slot while preserving full historical records.
-- Schedule-doctor ownership enforced via composite foreign key (schedule_id, doctor_id).
-- Idempotency enforced via UNIQUE (created_by, request_key).

ALTER TABLE doctor_schedules
    ADD CONSTRAINT uk_doctor_schedules_id_doctor UNIQUE (id, doctor_id);

CREATE TABLE appointments (
    id BIGINT NOT NULL AUTO_INCREMENT,
    appointment_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    patient_id BIGINT NOT NULL,
    doctor_id BIGINT NOT NULL,
    schedule_id BIGINT NOT NULL,
    created_by BIGINT NOT NULL,
    start_at_utc DATETIME(6) NOT NULL,
    end_at_utc DATETIME(6) NOT NULL,
    status VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT 'PENDING',
    reason VARCHAR(500) NULL,
    request_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active_slot_start_utc DATETIME(6) GENERATED ALWAYS AS (
        CASE WHEN status != 'CANCELLED' THEN start_at_utc ELSE NULL END
    ) STORED,
    version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_appointments PRIMARY KEY (id),
    CONSTRAINT uk_appointments_code UNIQUE (appointment_code),
    CONSTRAINT uk_appointments_created_by_request_key UNIQUE (created_by, request_key),
    CONSTRAINT uk_appointments_doctor_active_slot UNIQUE (doctor_id, active_slot_start_utc),
    CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id) REFERENCES patients (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_appointments_doctor FOREIGN KEY (doctor_id) REFERENCES doctors (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_appointments_schedule FOREIGN KEY (schedule_id) REFERENCES doctor_schedules (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_appointments_schedule_doctor FOREIGN KEY (schedule_id, doctor_id)
        REFERENCES doctor_schedules (id, doctor_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_appointments_created_by FOREIGN KEY (created_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_appointments_code CHECK (
        CHAR_LENGTH(appointment_code) > 0
        AND CAST(appointment_code AS BINARY) = CAST(UPPER(TRIM(appointment_code)) AS BINARY)
    ),
    CONSTRAINT chk_appointments_time_range CHECK (start_at_utc < end_at_utc),
    CONSTRAINT chk_appointments_status CHECK (
        status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')
    ),
    CONSTRAINT chk_appointments_reason CHECK (reason IS NULL OR CHAR_LENGTH(reason) <= 500),
    CONSTRAINT chk_appointments_request_key CHECK (
        CHAR_LENGTH(TRIM(request_key)) > 0
        AND CAST(request_key AS BINARY) = CAST(TRIM(request_key) AS BINARY)
    ),
    CONSTRAINT chk_appointments_request_fingerprint CHECK (
        CHAR_LENGTH(request_fingerprint) = 64
        AND CAST(request_fingerprint AS BINARY) = CAST(LOWER(TRIM(request_fingerprint)) AS BINARY)
    ),
    CONSTRAINT chk_appointments_version CHECK (version >= 0),
    INDEX ix_appointments_doctor_time_status (doctor_id, start_at_utc, end_at_utc, status),
    INDEX ix_appointments_patient_start_id (patient_id, start_at_utc, id),
    INDEX ix_appointments_status_start_id (status, start_at_utc, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
