-- CL-D06-DB: doctor_schedules table for work schedule management (FR-06).
-- Review before applying to any shared Clinic database.
-- start_at_utc and end_at_utc are UTC timestamps with microsecond precision.
-- work_date represents the working date in Asia/Ho_Chi_Minh (+07:00).
-- Shifts belong to a single day and do not cross local midnight.
-- slot_minutes supports standard increments (15, 30, 60 minutes).
-- status: ACTIVE generates booking slots; BLOCKED reserves/holds the shift without booking slots.
-- FK to doctors(id) uses ON DELETE RESTRICT ON UPDATE RESTRICT (no hard-deletes).
-- Overlap prevention across shifts is enforced at the service level via transactional locking on doctor.

CREATE TABLE doctor_schedules (
    id BIGINT NOT NULL AUTO_INCREMENT,
    doctor_id BIGINT NOT NULL,
    work_date DATE NOT NULL,
    start_at_utc DATETIME(6) NOT NULL,
    end_at_utc DATETIME(6) NOT NULL,
    slot_minutes SMALLINT NOT NULL DEFAULT 30,
    status VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT 'ACTIVE',
    version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_doctor_schedules PRIMARY KEY (id),
    CONSTRAINT fk_doctor_schedules_doctor FOREIGN KEY (doctor_id) REFERENCES doctors (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_doctor_schedules_time_range CHECK (start_at_utc < end_at_utc),
    CONSTRAINT chk_doctor_schedules_slot_minutes CHECK (slot_minutes IN (15, 30, 60)),
    CONSTRAINT chk_doctor_schedules_status CHECK (status IN ('ACTIVE', 'BLOCKED')),
    CONSTRAINT chk_doctor_schedules_version CHECK (version >= 0),
    INDEX ix_doctor_schedules_doctor_date_status (doctor_id, work_date, status),
    INDEX ix_doctor_schedules_doctor_start (doctor_id, start_at_utc)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
