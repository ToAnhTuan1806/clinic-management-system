package com.clinicmanagement.dto;

import com.clinicmanagement.validation.Utf8Size;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Locale;

public record RegisterRequest(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Size(min = 12, max = 72) @Utf8Size(max = 72) String password,
        @NotBlank @Size(max = 120) String fullName) {
    public RegisterRequest {
        email = email == null ? null : email.trim().toLowerCase(Locale.ROOT);
        fullName = fullName == null ? null : fullName.trim();
    }

    @Override
    public String toString() {
        return "RegisterRequest[redacted]";
    }
}
