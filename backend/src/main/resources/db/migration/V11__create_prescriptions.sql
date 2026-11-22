-- CL-D12-DB / FR-11: Prescription simulation schema.
-- Review before applying to any shared Clinic database.
-- All timestamps are stored in UTC with microsecond precision DATETIME(6).
-- A medical record has at most one prescription.
-- Simulation only: no pharmacy, legal prescribing, inventory, or billing integration.

CREATE TABLE prescriptions (
    id BIGINT NOT NULL AUTO_INCREMENT,
    medical_record_id BIGINT NOT NULL,
    created_by BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_prescriptions PRIMARY KEY (id),
    CONSTRAINT uk_prescriptions_medical_record UNIQUE (medical_record_id),
    CONSTRAINT fk_prescriptions_medical_record FOREIGN KEY (medical_record_id)
        REFERENCES medical_records (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_prescriptions_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    INDEX ix_prescriptions_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE prescription_items (
    id BIGINT NOT NULL AUTO_INCREMENT,
    prescription_id BIGINT NOT NULL,
    medication_name VARCHAR(200) NOT NULL,
    quantity INT NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    duration_days INT NOT NULL,
    instructions VARCHAR(1000) NULL,
    sort_order INT NOT NULL,
    CONSTRAINT pk_prescription_items PRIMARY KEY (id),
    CONSTRAINT uk_prescription_items_prescription_sort UNIQUE (prescription_id, sort_order),
    CONSTRAINT fk_prescription_items_prescription FOREIGN KEY (prescription_id)
        REFERENCES prescriptions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_prescription_items_quantity CHECK (quantity >= 1 AND quantity <= 10000),
    CONSTRAINT chk_prescription_items_duration_days CHECK (duration_days >= 1 AND duration_days <= 365),
    CONSTRAINT chk_prescription_items_sort_order CHECK (sort_order >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
