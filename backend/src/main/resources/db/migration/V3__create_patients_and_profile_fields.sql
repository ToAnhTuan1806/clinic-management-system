-- CL-D04-DB: patients table and profile fields foundation.
-- Review before applying to any shared Clinic database.
-- patient_code uses canonical uppercase ASCII; full_name and address use utf8mb4.
-- user_id is nullable (supports walk-in / guest patients) and UNIQUE (at most one patient profile per user).
-- Multiple unlinked patients (user_id IS NULL) are permitted by SQL standard and MySQL InnoDB.
-- Sex values are restricted to FEMALE, MALE, OTHER, UNKNOWN.
-- Phone, name, and date_of_birth are NOT unique. No auto-linking by phone or email.
-- FR-02 personal profile proposal: users.phone VARCHAR(24) NULL proposed to Backend; V1 users remains unchanged.

CREATE TABLE patients (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    patient_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    date_of_birth DATE NULL,
    sex VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    phone VARCHAR(24) NULL,
    address VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_patients PRIMARY KEY (id),
    CONSTRAINT uk_patients_user UNIQUE (user_id),
    CONSTRAINT uk_patients_code UNIQUE (patient_code),
    CONSTRAINT fk_patients_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_patients_code CHECK (
        CHAR_LENGTH(patient_code) > 0
        AND CAST(patient_code AS BINARY) = CAST(UPPER(TRIM(patient_code)) AS BINARY)
    ),
    CONSTRAINT chk_patients_full_name CHECK (
        CHAR_LENGTH(TRIM(full_name)) > 0
        AND CAST(full_name AS BINARY) = CAST(TRIM(full_name) AS BINARY)
    ),
    CONSTRAINT chk_patients_sex CHECK (
        sex IS NULL OR sex IN ('FEMALE', 'MALE', 'OTHER', 'UNKNOWN')
    ),
    CONSTRAINT chk_patients_phone CHECK (
        phone IS NULL OR (
            CHAR_LENGTH(TRIM(phone)) > 0
            AND CAST(phone AS BINARY) = CAST(TRIM(phone) AS BINARY)
        )
    ),
    CONSTRAINT chk_patients_address CHECK (address IS NULL OR CHAR_LENGTH(address) <= 255),
    CONSTRAINT chk_patients_active CHECK (is_active IN (0, 1)),
    INDEX ix_patients_active_name_id (is_active, full_name, id),
    INDEX ix_patients_phone (phone)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
