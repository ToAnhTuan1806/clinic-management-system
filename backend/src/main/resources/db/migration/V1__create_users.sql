-- CL-D02-DB: users only. Review before applying to any shared Clinic database.
-- Backend supplies canonical email, a password hash, and UTC timestamps.
CREATE TABLE users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    role VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    status VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    last_login_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uk_users_email UNIQUE (email),
    CONSTRAINT chk_users_email_canonical CHECK (
        CHAR_LENGTH(email) > 0
        AND CAST(email AS BINARY) = CAST(LOWER(TRIM(email)) AS BINARY)
    ),
    CONSTRAINT chk_users_role CHECK (
        role IN ('ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT')
    ),
    CONSTRAINT chk_users_status CHECK (
        status IN ('ACTIVE', 'DISABLED')
    )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
