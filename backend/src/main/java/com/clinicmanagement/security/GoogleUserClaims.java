package com.clinicmanagement.security;

public record GoogleUserClaims(
        String subject,
        String email,
        String fullName,
        boolean emailVerified
) {
}
