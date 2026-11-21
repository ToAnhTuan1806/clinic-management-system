package com.clinicmanagement.security;

import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.UserStatus;
import java.security.Principal;

public record AuthenticatedUser(Long id, String email, String fullName, Role role, UserStatus status)
        implements Principal {
    @Override
    public String getName() {
        return id.toString();
    }
}
