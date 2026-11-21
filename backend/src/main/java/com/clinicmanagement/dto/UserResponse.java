package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.security.AuthenticatedUser;

public record UserResponse(String id, String email, String fullName, Role role, UserStatus status) {
    public static UserResponse from(User user) {
        return new UserResponse(user.getId().toString(), user.getEmail(), user.getFullName(),
                user.getRole(), user.getStatus());
    }

    public static UserResponse from(AuthenticatedUser user) {
        return new UserResponse(user.id().toString(), user.email(), user.fullName(), user.role(), user.status());
    }
}
