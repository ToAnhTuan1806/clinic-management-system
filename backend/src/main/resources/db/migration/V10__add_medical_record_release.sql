-- CL-D11-DB / FR-09, FR-10. DATETIME(6) values are UTC by application contract.
-- Approved transition policy: preserve D10 patient-visible completed records.
-- New D11 completions remain unreleased until the assigned doctor releases them.
ALTER TABLE medical_records
    ADD COLUMN released_at DATETIME(6) NULL,
    ADD COLUMN released_by BIGINT NULL,
    ADD CONSTRAINT fk_medical_records_released_by FOREIGN KEY (released_by)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT chk_medical_records_release CHECK (
        (released_at IS NULL AND released_by IS NULL)
        OR (
            released_at IS NOT NULL AND released_by IS NOT NULL
            AND completed_at IS NOT NULL AND completed_by IS NOT NULL
            AND released_at >= completed_at
        )
    ),
    ADD INDEX ix_medical_records_released_by (released_by);

-- Historical attribution, not a claim that a separate release action occurred.
-- Do not change clinical content, original timestamps or optimistic-lock versions.
UPDATE medical_records m
JOIN appointments a ON a.id = m.appointment_id
SET m.released_at = m.completed_at,
    m.released_by = m.completed_by
WHERE a.status = 'COMPLETED'
    AND m.completed_at IS NOT NULL
    AND m.completed_by IS NOT NULL;
