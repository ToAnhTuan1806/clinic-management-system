-- CL-D04-DB-V4: profile contact fields on users table for FR-02.
-- Review before applying to any shared Clinic database.
-- Adds optional phone and address to users.
-- phone is not unique (family members may share contact number).
-- address is not unique.
-- phone must be trimmed non-empty if provided.
-- address has maximum length of 255 characters.
-- No default values with dummy data; existing users get NULL phone and address.
-- No auto-linking between users and patients by phone or email.

ALTER TABLE users
    ADD COLUMN phone VARCHAR(24) NULL,
    ADD COLUMN address VARCHAR(255) NULL,
    ADD CONSTRAINT chk_users_phone CHECK (
        phone IS NULL OR (
            CHAR_LENGTH(TRIM(phone)) > 0
            AND CAST(phone AS BINARY) = CAST(TRIM(phone) AS BINARY)
        )
    ),
    ADD CONSTRAINT chk_users_address CHECK (
        address IS NULL OR CHAR_LENGTH(address) <= 255
    );
