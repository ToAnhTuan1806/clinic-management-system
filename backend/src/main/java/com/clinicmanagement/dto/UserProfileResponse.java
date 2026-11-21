package com.clinicmanagement.dto;

import com.clinicmanagement.entity.Role;
import com.clinicmanagement.entity.User;
import com.clinicmanagement.entity.UserStatus;
import com.clinicmanagement.security.AuthenticatedUser;

public record UserProfileResponse(
        String id,
        String email,
        String fullName,
        Role role,
        UserStatus status,
        String phone,
        String address
) {
    public static UserProfileResponse from(User user) {
        return new UserProfileResponse(
                user.getId() != null ? user.getId().toString() : null,
                user.getEmail(),
                user.getFullName(),
                user.getRole(),
                user.getStatus(),
                user.getPhone(),
                user.getAddress()
        );
    }

    public static UserProfileResponse from(AuthenticatedUser user) {
        return new UserProfileResponse(
                user.id().toString(),
                user.email(),
                user.fullName(),
                user.role(),
                user.status(),
                null,
                null
        );
    }
}
