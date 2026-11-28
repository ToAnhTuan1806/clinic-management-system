-- D16: Add Google OAuth sign-in support for patient accounts.
ALTER TABLE users
    ADD COLUMN auth_provider VARCHAR(16) NOT NULL DEFAULT 'LOCAL' AFTER status,
    ADD COLUMN google_sub VARCHAR(255) NULL AFTER auth_provider,
    ADD CONSTRAINT chk_users_auth_provider CHECK (auth_provider IN ('LOCAL', 'GOOGLE')),
    ADD CONSTRAINT uk_users_google_sub UNIQUE (google_sub);
