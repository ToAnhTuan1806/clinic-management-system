-- CL-D10-DB / FR-09. Clinical content is nullable while drafting.
-- Backend owns workflow, completion validation, version updates and access control.
CREATE TABLE medical_records (
    id BIGINT NOT NULL AUTO_INCREMENT,
    appointment_id BIGINT NOT NULL,
    symptoms TEXT NULL,
    diagnosis TEXT NULL,
    notes TEXT NULL,
    conclusion TEXT NULL,
    created_by BIGINT NOT NULL,
    completed_at DATETIME(6) NULL,
    completed_by BIGINT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_medical_records PRIMARY KEY (id),
    CONSTRAINT uk_medical_records_appointment UNIQUE (appointment_id),
    CONSTRAINT fk_medical_records_appointment FOREIGN KEY (appointment_id)
        REFERENCES appointments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_medical_records_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_medical_records_completed_by FOREIGN KEY (completed_by)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_medical_records_version CHECK (version >= 0),
    CONSTRAINT chk_medical_records_completion CHECK (
        (completed_at IS NULL AND completed_by IS NULL)
        OR (completed_at IS NOT NULL AND completed_by IS NOT NULL AND completed_at >= created_at)
    ),
    INDEX ix_medical_records_created_by (created_by),
    INDEX ix_medical_records_completed_by (completed_by)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
