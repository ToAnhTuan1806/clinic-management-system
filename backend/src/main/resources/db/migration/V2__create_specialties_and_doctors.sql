-- CL-D03-DB: catalog tables only. No seed data, user changes or hard-delete API.
-- Codes/licenses are canonical uppercase; specialty names use case/accent-insensitive uniqueness.
-- User role/status, active-specialty rules and authorization are enforced by BE transactions.
CREATE TABLE specialties (
    id BIGINT NOT NULL AUTO_INCREMENT,
    code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_specialties PRIMARY KEY (id),
    CONSTRAINT uk_specialties_code UNIQUE (code),
    CONSTRAINT uk_specialties_name UNIQUE (name),
    CONSTRAINT chk_specialties_code CHECK (
        CHAR_LENGTH(code) > 0
        AND CAST(code AS BINARY) = CAST(UPPER(TRIM(code)) AS BINARY)
    ),
    CONSTRAINT chk_specialties_name CHECK (
        CHAR_LENGTH(TRIM(name)) > 0
        AND CAST(name AS BINARY) = CAST(TRIM(name) AS BINARY)
    ),
    CONSTRAINT chk_specialties_description CHECK (description IS NULL OR CHAR_LENGTH(description) <= 5000),
    CONSTRAINT chk_specialties_active CHECK (is_active IN (0, 1)),
    INDEX ix_specialties_active_code_id (is_active, code, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE doctors (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    specialty_id BIGINT NOT NULL,
    doctor_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    license_number VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    biography TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_doctors PRIMARY KEY (id),
    CONSTRAINT uk_doctors_user UNIQUE (user_id),
    CONSTRAINT uk_doctors_code UNIQUE (doctor_code),
    CONSTRAINT uk_doctors_license UNIQUE (license_number),
    CONSTRAINT fk_doctors_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_doctors_specialty FOREIGN KEY (specialty_id) REFERENCES specialties (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_doctors_code CHECK (
        CHAR_LENGTH(doctor_code) > 0
        AND CAST(doctor_code AS BINARY) = CAST(UPPER(TRIM(doctor_code)) AS BINARY)
    ),
    CONSTRAINT chk_doctors_license CHECK (
        license_number IS NULL OR (
            CHAR_LENGTH(license_number) > 0
            AND CAST(license_number AS BINARY) = CAST(UPPER(TRIM(license_number)) AS BINARY)
        )
    ),
    CONSTRAINT chk_doctors_biography CHECK (biography IS NULL OR CHAR_LENGTH(biography) <= 5000),
    CONSTRAINT chk_doctors_active CHECK (is_active IN (0, 1)),
    INDEX ix_doctors_specialty_active_id (specialty_id, is_active, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
